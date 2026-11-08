// The host side of every extension point (docs/phases/37-extensions/02–03).
//
// A host picks the helper that matches its point's `pattern` and passes a context; everything a host used to
// hand-write — tenant gating, isolation of one contributor from the others, timeouts, logging, the failure
// policy — happens here, the same way for every point. ~100 call sites hand-rolled these loops in seven
// different ways before; the README of the phase set lists what that cost.
//
// The caller still imports its point's generated loader map and passes it in: that keeps a host's bundle to
// its own point's implementations (see extension-registry.ts for why).

import { AppError, ErrorCode } from '../app-error';
import {
  extensionRegistry, type ExtensionPointLoaders, type RuntimeExtension, type RuntimeExtensionPoint,
} from '../extension-registry';
import type { ModuleScope } from '../module-manifest.types';
import { resolveContributorStates, type ContributorState, type StateVerdict } from './contributor-state';
import { beforeCall, breakerEnabled, isQuarantined, recordFailure, recordSuccess } from './breaker';

/**
 * Who is asking. A tenant context gets the behaviour gate (only active contributors); a system context is for
 * boot, catalogs and other work that belongs to no tenant, and must say why it needs every contributor.
 * `scope` filters by the contribution's declared scope, only when given (its meaning differs across points).
 * `permissions`, when given, drops contributions whose declared permissions the caller does not hold.
 */
export type ExtCtx =
  | { tenantId: string; permissions?: Iterable<string>; scope?: ModuleScope }
  | { system: true; reason: string; scope?: ModuleScope };

export const tenantCtx = (tenantId: string, extra: { permissions?: Iterable<string>; scope?: ModuleScope } = {}): ExtCtx => ({ tenantId, ...extra });
export const systemCtx = (reason: string, scope?: ModuleScope): ExtCtx => ({ system: true, reason, ...(scope ? { scope } : {}) });

export type FailureReason = 'load' | 'threw' | 'timeout' | 'invalid' | 'quarantined';

export interface ContributionFailure {
  point: string;
  contributionId: string;
  moduleId: string;
  reason: FailureReason;
  message: string;
}

/** A selected provider whose module is not active for the tenant, or that failed to load (409, never 500). */
export class ProviderUnavailableError extends AppError {
  constructor(
    readonly point: string,
    readonly key: string | null,
    readonly state: ContributorState | 'not_installed' | 'failed',
    readonly reason?: string,
  ) {
    super(
      `The ${key ? `'${key}' ` : ''}provider for ${point} is not available${reason ? `: ${reason}` : ''}`,
      409, ErrorCode.PROVIDER_UNAVAILABLE,
      { details: { point, key, state, ...(reason ? { reason } : {}) } },
    );
    this.name = 'ProviderUnavailableError';
  }
}

/** A point declared `onFailure: 'fail-closed'` and at least one contributor failed. */
export class ContributionFailedError extends Error {
  constructor(readonly point: string, readonly failed: ContributionFailure[]) {
    super(`${point}: ${failed.map((f) => `${f.moduleId} ${f.reason}: ${f.message}`).join('; ')}`);
    this.name = 'ContributionFailedError';
  }
}

export interface ContributionOutcome {
  ctx: ExtCtx;
  contribution: RuntimeExtension;
  ok: boolean;
  failure?: ContributionFailure;
  ms: number;
}

const outcomeListeners = new Set<(o: ContributionOutcome) => void>();

/** Observe every contribution call (the breaker and the metrics of phase 04 subscribe here). */
export function onContributionOutcome(listener: (o: ContributionOutcome) => void): () => void {
  outcomeListeners.add(listener);
  return () => { outcomeListeners.delete(listener); };
}

/** Per-contribution budget when the point declares none. A detached fan-out may take longer: nobody waits. */
const DEFAULT_TIMEOUT_MS: Record<RuntimeExtensionPoint['pattern'], number> = {
  guard: 2000, pipeline: 2000, fanout: 5000, aggregate: 5000, first: 5000, select: 10000, catalog: 10000, component: 10000,
};

function pointOf(point: string): RuntimeExtensionPoint | undefined {
  // Optional call: module tests often mock the registry with getContributions/load only; they get the defaults.
  return extensionRegistry.getPoint?.(point);
}

function timeoutFor(point: string, override?: number, detached = false): number {
  if (override) return override;
  const def = pointOf(point);
  if (def?.timeoutMs) return def.timeoutMs;
  if (detached) return 10000;
  return DEFAULT_TIMEOUT_MS[def?.pattern ?? 'fanout'];
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// One import shared by every failure: the logger reads the environment, so it is loaded on the failure path only
// (hosts that merely declare points must not need it), and concurrent dynamic imports of it raced under test runners.
let loggerImport: Promise<typeof import('@kuraykaraaslan-labs/logger')> | null = null;
export const loadLogger = async () => (await (loggerImport ??= import('@kuraykaraaslan-labs/logger'))).default;

async function logFailure(f: ContributionFailure, ctx: ExtCtx): Promise<void> {
  const Logger = await loadLogger();
  const who = 'system' in ctx ? `system (${ctx.reason})` : `tenant ${ctx.tenantId}`;
  Logger.warn(`[extensions] ${f.point} <- ${f.contributionId}: ${f.reason}: ${f.message} [${who}]`);
}

function emit(o: ContributionOutcome): void {
  for (const l of outcomeListeners) {
    try { l(o); } catch { /* an observer must never break a host */ }
  }
}

/** The states that stop a contributor of a `platform`-gated point: the ones the platform, not the tenant, decides. */
const PLATFORM_STATES = new Set<ContributorState>(['banned', 'retired', 'missing']);

/** The breaker scope of a context: the tenant, or `system`. */
const scopeOf = (ctx: ExtCtx): string => ('system' in ctx ? 'system' : ctx.tenantId);

/**
 * The contributions a context may use, in order. Behaviour points drop every contributor a source objects to;
 * data points keep them all (EXT-1), as does a system context; platform points drop only what the platform stopped. A contribution whose breaker is open for the
 * scope is left out too (04) — except for a guard, which must count it as unverifiable (EXT-3).
 */
export async function contributionsFor(point: string, ctx: ExtCtx, opts: { keepQuarantined?: boolean } = {}): Promise<RuntimeExtension[]> {
  let list = extensionRegistry.getContributions(point, {
    ...(ctx.scope ? { scope: ctx.scope } : {}),
    ...('permissions' in ctx && ctx.permissions ? { permissions: [...ctx.permissions] } : {}),
  });
  const gate = pointOf(point)?.gate ?? 'behaviour';
  if (!('system' in ctx) && gate !== 'data' && list.length) {
    const states = await resolveContributorStates(ctx.tenantId);
    if (states.size) {
      // platform: operator modules act on every tenant whatever the tenant switched on; only the platform stops them.
      list = gate === 'platform'
        ? list.filter((e) => !PLATFORM_STATES.has(states.get(e.moduleId)?.state as ContributorState))
        : list.filter((e) => !states.has(e.moduleId));
    }
  }
  if (!opts.keepQuarantined) {
    const scope = scopeOf(ctx);
    list = list.filter((e) => !isQuarantined(scope, e.id));
  }
  return list;
}

/** Every contribution to a point with the state it is in for the context (placeholders, orphan reports, admin views). */
export async function contributionStates(point: string, ctx: ExtCtx): Promise<Array<{ contribution: RuntimeExtension; state: ContributorState; reason?: string }>> {
  const all = extensionRegistry.getContributions(point);
  const states = 'system' in ctx ? new Map<string, StateVerdict>() : await resolveContributorStates(ctx.tenantId);
  return all.map((contribution) => {
    const v = states.get(contribution.moduleId);
    return { contribution, state: v?.state ?? 'active', ...(v?.reason ? { reason: v.reason } : {}) };
  });
}

type Invoked<R> = { ok: true; value: R } | { ok: false; failure: ContributionFailure };

class ContributionTimeout extends Error {}

/** A typed refusal (an AppError below 500) is an answer the contribution chose, not a sign it is broken. */
const isAnswer = (error: unknown) => error instanceof AppError && error.statusCode < 500;

/** Load one contribution and run `fn` on it inside its budget; never throws. */
async function invoke<T, R>(
  ctx: ExtCtx,
  ext: RuntimeExtension,
  loaders: ExtensionPointLoaders,
  fn: (impl: T, signal: AbortSignal, ext: RuntimeExtension) => R | Promise<R>,
  timeoutMs: number,
  validate?: (value: R) => boolean,
  opts: {
    /**
     * True when the value is code the host takes away and calls later (select): its success is not this call's to
     * record, the host's calls of it are judged instead (guarded()). A load error still counts here.
     */
    judgedLater?: (value: R) => boolean;
  } = {},
): Promise<Invoked<R>> {
  const started = Date.now();
  const scope = scopeOf(ctx);
  if (isQuarantined(scope, ext.id)) {
    const failure: ContributionFailure = { point: ext.point, contributionId: ext.id, moduleId: ext.moduleId, reason: 'quarantined', message: 'paused after repeated errors' };
    return { ok: false, failure };
  }
  beforeCall(scope, ext.id);
  const fail = (reason: FailureReason, error: unknown): Invoked<R> => {
    const failure: ContributionFailure = { point: ext.point, contributionId: ext.id, moduleId: ext.moduleId, reason, message: asMessage(error) };
    void logFailure(failure, ctx);
    // An answer counts as a call that worked: it keeps the failure ratio honest, and a probe that answers closes.
    if (isAnswer(error)) recordSuccess(scope, ext);
    else recordFailure(scope, ext, reason);
    emit({ ctx, contribution: ext, ok: false, failure, ms: Date.now() - started });
    return { ok: false, failure };
  };
  let impl: T;
  try {
    impl = await extensionRegistry.load<T>(ext, loaders);
  } catch (error) {
    return fail('load', error);
  }
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => fn(impl, abort.signal, ext)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new ContributionTimeout(`no answer within ${timeoutMs} ms`)); }, timeoutMs);
      }),
    ]);
    if (validate && !validate(value)) return fail('invalid', new Error('answer does not match the point contract'));
    if (opts.judgedLater?.(value)) return { ok: true, value };
    recordSuccess(scope, ext);
    emit({ ctx, contribution: ext, ok: true, ms: Date.now() - started });
    return { ok: true, value };
  } catch (error) {
    return fail(error instanceof ContributionTimeout ? 'timeout' : 'threw', error);
  } finally {
    clearTimeout(timer);
  }
}

// Built-ins answer as data even though their prototypes carry methods: a Map's `get` is not the contributor's code.
const DATA_PROTOTYPES = new Set<object>([
  Object.prototype, Array.prototype, Map.prototype, Set.prototype, WeakMap.prototype, WeakSet.prototype,
  Date.prototype, RegExp.prototype, Promise.prototype, Error.prototype,
]);

/** Code the host may call later: a function, or an object with a method of its own or of its class (not a built-in's). */
function isCode(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (typeof value !== 'object' || value === null || Array.isArray(value) || ArrayBuffer.isView(value)) return false;
  for (let o: object | null = value; o && !DATA_PROTOTYPES.has(o); o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) {
      if (name === 'constructor') continue;
      const d = Object.getOwnPropertyDescriptor(o, name);
      if (d && 'value' in d && typeof d.value === 'function') return true;
    }
  }
  return false;
}

/**
 * Whether a value handed to the host is guarded. With the breaker off (unit tests, unless one turns it on) there is
 * nothing to judge, so the host keeps the very object it was given (module tests compare it).
 */
const willGuard = (value: unknown): boolean => breakerEnabled() && isCode(value);

const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function';

/**
 * Run one call of a guarded implementation and judge it like invoke() judges its calls: a throw or a rejection counts
 * against the breaker unless it is an AppError below 500 (an answer); a return or a fulfilment counts for it. The
 * host gets exactly what the call gave (the same promise, the same error); nothing is retried, timed or logged here,
 * because the host sees the error itself.
 */
function judged<R>(ctx: ExtCtx, ext: RuntimeExtension, call: () => R): R {
  const scope = scopeOf(ctx);
  const started = Date.now();
  beforeCall(scope, ext.id);
  const settle = (failed: boolean, error?: unknown) => {
    if (!failed) {
      recordSuccess(scope, ext);
      emit({ ctx, contribution: ext, ok: true, ms: Date.now() - started });
      return;
    }
    if (isAnswer(error)) recordSuccess(scope, ext);
    else recordFailure(scope, ext, 'threw');
    const failure: ContributionFailure = { point: ext.point, contributionId: ext.id, moduleId: ext.moduleId, reason: 'threw', message: asMessage(error) };
    emit({ ctx, contribution: ext, ok: false, failure, ms: Date.now() - started });
  };
  let result: R;
  try {
    result = call();
  } catch (error) {
    settle(true, error);
    throw error;
  }
  // The host keeps the original promise; this side chain only observes it (and handles the rejection it sees, so it
  // adds no unhandled one).
  if (isThenable(result)) result.then(() => settle(false), (error: unknown) => settle(true, error));
  else settle(false);
  return result;
}

// One proxy per implementation, scope and contribution: a host that selects the same provider twice gets the same object.
const guardedCache = new WeakMap<object, Map<string, object>>();
// The original behind each method wrapper, so a reassigned method is wrapped again rather than served stale.
const wrappedOriginal = new WeakMap<object, unknown>();

/**
 * The implementation a host takes away and calls later (select's provider, a `first` answer that is code): every
 * call of the function itself, or of a function member, is judged (judged()). The proxy changes nothing else: other
 * properties pass through, a method runs with the real object as `this` (private fields keep working, and its own
 * calls of sibling methods are not counted twice), each read of a method gives the same wrapper, and a frozen method
 * is served unwrapped because a proxy may not change it. Data answers are returned as they are.
 */
function guarded<T>(value: T, ctx: ExtCtx, ext: RuntimeExtension): T {
  if (!willGuard(value)) return value;
  const target = value as unknown as object;
  const key = `${scopeOf(ctx)}|${ext.id}`;
  let byKey = guardedCache.get(target);
  const hit = byKey?.get(key);
  if (hit) return hit as T;
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const handler: ProxyHandler<object> = {
    get(t, prop) {
      const v: unknown = Reflect.get(t, prop);
      if (typeof v !== 'function' || typeof prop === 'symbol' || prop === 'constructor' || prop === 'then') return v;
      // What every function or object inherits (bind, call, toString, hasOwnProperty) is not the contributor's code.
      if (v === Reflect.get(Function.prototype, prop) || v === Reflect.get(Object.prototype, prop)) return v;
      const d = Object.getOwnPropertyDescriptor(t, prop);
      if (d && !d.configurable && 'value' in d && !d.writable) return v;
      let w = methods.get(prop);
      if (!w || wrappedOriginal.get(w) !== v) {
        const method = v as (...args: unknown[]) => unknown;
        w = function guardedMethod(this: unknown, ...args: unknown[]) {
          return judged(ctx, ext, () => Reflect.apply(method, this === proxy ? t : this, args));
        };
        wrappedOriginal.set(w, v);
        methods.set(prop, w);
      }
      return w;
    },
  };
  if (typeof target === 'function') {
    handler.apply = (t, self, args) => judged(ctx, ext, () => Reflect.apply(t as (...a: unknown[]) => unknown, self, args));
  }
  const proxy: object = new Proxy(target, handler);
  if (!byKey) guardedCache.set(target, (byKey = new Map()));
  byKey.set(key, proxy);
  return proxy as T;
}

interface CallOptions<R> {
  /** Overrides the point's budget for this call. */
  timeoutMs?: number;
  /** Rejects a malformed answer as a failure instead of passing it to the host. */
  validate?: (value: R) => boolean;
  /** Run one after another in order instead of together (order-sensitive work, boot). */
  sequential?: boolean;
}

async function runAll<T, R>(
  point: string, ctx: ExtCtx, list: RuntimeExtension[], loaders: ExtensionPointLoaders,
  fn: (impl: T, signal: AbortSignal, ext: RuntimeExtension) => R | Promise<R>, opts: CallOptions<R> & { detached?: boolean },
): Promise<{ results: Array<{ contribution: RuntimeExtension; value: R }>; failed: ContributionFailure[] }> {
  const ms = timeoutFor(point, opts.timeoutMs, opts.detached);
  const settled: Array<{ ext: RuntimeExtension; r: Invoked<R> }> = [];
  if (opts.sequential) {
    for (const ext of list) settled.push({ ext, r: await invoke(ctx, ext, loaders, fn, ms, opts.validate) });
  } else {
    settled.push(...await Promise.all(list.map(async (ext) => ({ ext, r: await invoke(ctx, ext, loaders, fn, ms, opts.validate) }))));
  }
  const results: Array<{ contribution: RuntimeExtension; value: R }> = [];
  const failed: ContributionFailure[] = [];
  for (const { ext, r } of settled) {
    if (r.ok) results.push({ contribution: ext, value: r.value });
    else failed.push(r.failure);
  }
  return { results, failed };
}

function failClosed(point: string): boolean {
  return pointOf(point)?.onFailure === 'fail-closed';
}

export const ext = {
  contributions: contributionsFor,
  states: contributionStates,

  /**
   * select: the provider for `key` (or the first active one when no key is given). An inactive or failing
   * provider is replaced according to the point's `fallback`: `any` takes the next active one, `default`
   * returns null so the host uses its built-in, `none` throws ProviderUnavailableError (409).
   * The host calls the provider after this returns, so `impl` is guarded: what those calls do is what the breaker
   * judges (a provider that loads but throws when called used to look healthy to it).
   */
  async select<T>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders, opts: { key?: string | null } = {},
  ): Promise<{ impl: T; contribution: RuntimeExtension } | null> {
    const fallback = pointOf(point)?.fallback ?? 'none';
    const active = await contributionsFor(point, ctx);
    const ms = timeoutFor(point);
    const load = (e: RuntimeExtension) => invoke<T, T>(ctx, e, loaders, (impl) => impl, ms, undefined, { judgedLater: willGuard });
    const byName = opts.key !== undefined && opts.key !== null;
    const wanted = byName ? active.find((e) => e.key === opts.key) : active[0];
    let failure: ContributionFailure | undefined;
    if (wanted) {
      const r = await load(wanted);
      if (r.ok) return { impl: guarded(r.value, ctx, wanted), contribution: wanted };
      failure = r.failure;
    }
    if (fallback === 'any') {
      for (const e of active) {
        if (e === wanted) continue;
        const r = await load(e);
        if (r.ok) return { impl: guarded(r.value, ctx, e), contribution: e };
      }
    }
    if (fallback === 'default') return null;
    // Nothing installed and nothing asked for by name: the host decides (built-in, empty list, its own 4xx).
    if (!byName && !failure) return null;
    if (failure) throw new ProviderUnavailableError(point, opts.key ?? wanted?.key ?? null, 'failed', failure.message);
    const known = extensionRegistry.getContributions(point).find((e) => e.key === opts.key);
    if (!known) throw new ProviderUnavailableError(point, opts.key ?? null, 'not_installed');
    const verdict = 'system' in ctx ? undefined : (await resolveContributorStates(ctx.tenantId)).get(known.moduleId);
    // Active but paused by its breaker: say so, rather than "not installed".
    if (!verdict && isQuarantined(scopeOf(ctx), known.id)) {
      throw new ProviderUnavailableError(point, opts.key ?? null, 'quarantined', 'paused after repeated errors');
    }
    throw new ProviderUnavailableError(point, opts.key ?? null, verdict?.state ?? 'not_installed', verdict?.reason);
  },

  /**
   * first: the first contribution whose `fn` answers (not null/undefined). Failures are skipped unless the point fails closed.
   * An answer that is code (the implementation itself, or an object it made) is guarded like select's provider, so
   * the calls the host makes on it later are judged too; a data answer is returned as it is.
   */
  async first<T, R>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders,
    fn: (impl: T, signal: AbortSignal, ext: RuntimeExtension) => R | null | undefined | Promise<R | null | undefined>,
    opts: Omit<CallOptions<R>, 'sequential'> = {},
  ): Promise<{ value: R; contribution: RuntimeExtension } | null> {
    const ms = timeoutFor(point, opts.timeoutMs);
    const failed: ContributionFailure[] = [];
    // On a fail-closed point a paused contributor is a failure, not an absence: skipping it would turn "the archive
    // exporter is paused" into "there is no archive exporter".
    for (const e of await contributionsFor(point, ctx, { keepQuarantined: failClosed(point) })) {
      // A pass (null/undefined) is not an answer, so it is not validated.
      const validate = opts.validate ? (v: R | null | undefined) => v === null || v === undefined || opts.validate!(v as R) : undefined;
      const r = await invoke<T, R | null | undefined>(ctx, e, loaders, fn, ms, validate);
      if (!r.ok) {
        failed.push(r.failure);
        if (failClosed(point)) throw new ContributionFailedError(point, failed);
        continue;
      }
      if (r.value !== null && r.value !== undefined) return { value: guarded(r.value, ctx, e), contribution: e };
    }
    return null;
  },

  /**
   * fanout: every contribution, for its side effects. One failure never stops the others. A point declared
   * fail-closed throws ContributionFailedError after all ran (so e.g. a payment event is retried).
   * `detached` starts the work and returns at once (nobody waits for it; failures are still logged and counted).
   */
  async fanOut<T>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders,
    fn: (impl: T, signal: AbortSignal, ext: RuntimeExtension) => unknown,
    opts: Omit<CallOptions<unknown>, 'validate'> & { detached?: boolean } = {},
  ): Promise<{ failed: ContributionFailure[] }> {
    const work = (async () => {
      // A paused contributor is skipped, but reported in `failed` (reason 'quarantined'): a fail-closed point still
      // fails (a payment event is retried rather than acknowledged for a rail that never saw it), and a host that
      // logs its failures says why a ledger entry or a hook did not happen.
      const list = await contributionsFor(point, ctx, { keepQuarantined: true });
      return runAll<T, unknown>(point, ctx, list, loaders, fn, opts);
    })();
    if (opts.detached) {
      void work.catch(async (error) => {
        const Logger = await loadLogger();
        Logger.error(`[extensions] detached fan-out of ${point} failed before it started: ${asMessage(error)}`);
      });
      return { failed: [] };
    }
    const { failed } = await work;
    if (failed.length && failClosed(point)) throw new ContributionFailedError(point, failed);
    return { failed };
  },

  /** aggregate: every contribution's answer, with the ones that failed listed (the host decides what to show). */
  async aggregate<T, R>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders,
    fn: (impl: T, signal: AbortSignal, ext: RuntimeExtension) => R | Promise<R>,
    opts: CallOptions<R> = {},
  ): Promise<{ results: Array<{ contribution: RuntimeExtension; value: R }>; failed: ContributionFailure[] }> {
    const out = await runAll<T, R>(point, ctx, await contributionsFor(point, ctx, { keepQuarantined: true }), loaders, fn, opts);
    if (out.failed.length && failClosed(point)) throw new ContributionFailedError(point, out.failed);
    return out;
  },

  /**
   * guard: every contribution's verdict, and `blocked` when one could not answer (EXT-3). The host reads the
   * refusals from `results` itself — guards answer in different shapes (counts, reasons, limits).
   * `failOpen` is honoured only when the point declares it (quota guards), and is the host's call per request.
   */
  async guard<T, R>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders,
    fn: (impl: T, signal: AbortSignal, ext: RuntimeExtension) => R | Promise<R>,
    opts: CallOptions<R> & { failOpen?: boolean } = {},
  ): Promise<{ results: Array<{ contribution: RuntimeExtension; value: R }>; unverifiable: ContributionFailure[]; blocked: boolean }> {
    // Enforced wherever the contract is readable (always, outside test doubles of the registry).
    const def = pointOf(point);
    if (opts.failOpen && def && !def.failOpen) {
      throw new Error(`${point} does not declare failOpen, so a host may not fail it open (EXT-3)`);
    }
    // keepQuarantined: a paused contributor is not "no objection" — invoke() reports it as unverifiable.
    const { results, failed } = await runAll<T, R>(point, ctx, await contributionsFor(point, ctx, { keepQuarantined: true }), loaders, fn, opts);
    return { results, unverifiable: failed, blocked: failed.length > 0 && !opts.failOpen };
  },

  /**
   * pipeline: each contribution transforms the value in order; a failing step is skipped and the value carries on.
   * Every call of a contributor happens inside `fn`, so the breaker sees all of them; nothing is guarded.
   */
  async pipeline<T, V>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders, initial: V,
    fn: (impl: T, value: V, signal: AbortSignal, ext: RuntimeExtension) => V | Promise<V>,
    opts: Omit<CallOptions<V>, 'sequential'> = {},
  ): Promise<{ value: V; failed: ContributionFailure[] }> {
    const ms = timeoutFor(point, opts.timeoutMs);
    let value = initial;
    const failed: ContributionFailure[] = [];
    for (const e of await contributionsFor(point, ctx)) {
      const current = value;
      const r = await invoke<T, V>(ctx, e, loaders, (impl, signal, x) => fn(impl, current, signal, x), ms, opts.validate);
      if (r.ok) value = r.value;
      else failed.push(r.failure);
    }
    return { value, failed };
  },

  /**
   * catalog with code: every contribution's implementation, loaded; the ones that fail to load are listed.
   * Not guarded (yet): catalogs are loaded once and called per event (a websocket namespace per client message), where
   * a caller's bad input would count against the contributor; that needs a decision per point (docs/phases/37-extensions/04).
   */
  async loadAll<T>(
    point: string, ctx: ExtCtx, loaders: ExtensionPointLoaders, opts: Pick<CallOptions<T>, 'validate'> = {},
  ): Promise<{ loaded: Array<{ contribution: RuntimeExtension; impl: T }>; failed: ContributionFailure[] }> {
    const { results, failed } = await runAll<T, T>(point, ctx, await contributionsFor(point, ctx), loaders, (impl) => impl, { ...opts, timeoutMs: timeoutFor(point) });
    return { loaded: results.map((r) => ({ contribution: r.contribution, impl: r.value })), failed };
  },
};
