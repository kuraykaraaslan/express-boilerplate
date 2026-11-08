import Logger from '@kuraykaraaslan-labs/logger';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import {
  requestPrincipalOf, setRequestObserver, type RequestObservation, type RequestPrincipal,
} from '@kuraykaraaslan-labs/common/server/request-observer';
import type { MetricSource } from '@kuraykaraaslan-labs/common/server/process-hooks';
import type { SecuritySignalInput } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';
import {
  HINTS_PER_FLUSH, HINT_COOLDOWN_MS, requestPatternSignal, worthALook, type PatternActor,
} from '../detect/ai_firewall.request-pattern';
import { featureIdKey, featureIdOf, featureTagOf } from './ai_firewall.feature-id';
import { PLATFORM_SCOPE, PROFILE_FIELDS_MAX, tenantScope, type DistinctDim } from './ai_firewall.feature-windows';
import { DEEP_PAGE, requestMetaOf, type RequestMeta } from './ai_firewall.request-meta';
import { writeFeatureUpdates, FeatureRedisUnavailable, type FeatureRedis, type FeatureUpdate } from './ai_firewall.feature-writer';

/**
 * The request half of the feature store (docs/phases/55-ai-firewall/02 §2.1; coordinator decision for 3 333 req/s, D55-21): every
 * request the proxy and the tenant API dispatcher observe (common/server/request-observer.ts) is reduced IN PROCESS to counts and
 * classes (`requestMetaOf`, pure) and folded into per-actor counters of this process. A timer flushes them every FLUSH_INTERVAL_MS as
 * one bounded pipeline (`writeFeatureUpdates`). On the request path there is no Redis call, no await, no signal, no allocation beyond
 * the actor's counter object, and nothing that can throw out of `observe` (the seam catches anyway).
 *
 * Actors of one request: its address (platform scope: an address is not one tenant's) and, when the guard noted a caller, the person or
 * the API key (the tenant's scope). Both get the request's counters; the address learns the account (distinct accounts per address),
 * the account learns the address (distinct addresses per account). A person or a key also gets its day profile (hour, route class,
 * export bytes, admin writes, device, role) for the daily baseline.
 *
 * Bounded memory: at most MAX_ACTORS actors per flush (a new actor beyond is dropped and counted `actor_cap`), at most
 * DISTINCT_MEMBERS_MAX members per dimension, the per-actor sequence and timing state capped at TRACK_MAX entries (cleared when full),
 * a day profile at PROFILE_FIELDS_MAX fields (a new field beyond is left out, as Redis does; D55-49), and the user agent read for the
 * device tag at DEVICE_UA_MAX characters (D55-45).
 *
 * Impersonation (D55-47): the guard notes the operator, flagged `impersonating`; such a request counts in the operator's windows and
 * never in a day profile (it is neither the operator's usual work in the tenant nor the impersonated person's).
 * Failure: a flush that cannot write drops its batch and counts it (`redis_unavailable`, `flush_failed`), never retries; a request never
 * notices (FWA-7). No key to hash ids with: nothing is folded (`no_key`).
 *
 * Nominations for the detectors (02 §2.3, D55-31): with an `emit` (the boot task passes `emitSecuritySignal`), each flush hands the
 * actors whose counters of that flush clear a bar (`worthALook`) to the worker as ONE `ai_firewall.request_pattern` signal each (counts
 * only), at most once per actor per HINT_COOLDOWN_MS and HINTS_PER_FLUSH per flush; the rest are counted (`hints.capped`). The raw
 * address or caller id a nomination names lives in this process's memory until the flush, never in Redis.
 */
export const FLUSH_INTERVAL_MS = 5_000;
export const MAX_ACTORS = 5_000;
export const TRACK_MAX = 20_000;
const MEMBERS_MAX = 64;
/** A gap that repeats the previous gap within this share is "regular" (scripted clients tick; people do not). */
const REGULAR_GAP_SHARE = 0.1;
/** Gaps longer than this are not timing at all. */
const REGULAR_GAP_MAX_MS = 60_000;
/** The part of a user agent the device tag is made of (a browser's is 100 to 250 characters; the rest is no device, only padding). */
export const DEVICE_UA_MAX = 256;
/**
 * 04.8: the route template of auth's step-up verification. Its 2xx answer, with the caller the guard noted, is a second factor proved on
 * the caller's session: the fold counts it under that session (`sup:<keyed session tag>`, the caller's windows only, so every process's
 * request cascade learns it within a flush; a request without a session id counts nothing) and tells this process's cascade at once
 * (`setStepUpListener`). Per session, not per person (D55-125): another session of the person, such as a hijacked one, is asked as before.
 * One field per proving session and hour: a handful, each behind a real second factor.
 */
export const STEP_UP_VERIFY_ROUTE = '/api/auth/step-up/verify';
const STEP_UP_PROVED_PREFIX = 'sup:';

export type StepUpListener = (who: { tenantId: string; userId: string; sessionId: string | null }) => void;
const STEP_UP_LISTENER_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.stepUpListener');
const listenerHolder = globalThis as unknown as Record<symbol, StepUpListener | null | undefined>;
/** The request cascade's runtime registers here (one listener per process); null removes it. */
export function setStepUpListener(listener: StepUpListener | null): void {
  listenerHolder[STEP_UP_LISTENER_KEY] = listener;
}

export const FOLD_DROP_REASONS = [
  'no_key', 'no_address', 'actor_cap', 'command_cap', 'endpoint_cap', 'redis_unavailable', 'flush_failed', 'error',
] as const;
export type FoldDropReason = (typeof FOLD_DROP_REASONS)[number];

export interface FoldStats {
  observed: { proxy: number; api: number; asset: number };
  /** Actor updates written to Redis. */
  written: number;
  flushes: number;
  dropped: Record<FoldDropReason, number>;
  /** Nominations for the detectors: emitted, and left out (per-flush cap or a refused emit). */
  hints: { emitted: number; capped: number };
}

interface ActorFold {
  scope: string;
  kind: string;
  hash: string;
  counters: Record<string, number>;
  distinct: Partial<Record<DistinctDim, Set<string>>>;
  endpoints: Set<string> | null;
  profile: Record<string, number> | null;
  /** Fields in `profile` (PROFILE_FIELDS_MAX). */
  profileFields: number;
  profileDistinct: { addr?: Set<string> } | null;
  role: string | null;
  /** Who this is, in memory only, for a nomination (never written). */
  ref: PatternActor | null;
}

interface Track {
  lastId: number | null;
  lastRoute: string | null;
  lastAt: number;
  lastGap: number;
}

export interface RequestFoldOptions {
  redis?: FeatureRedis | (() => Promise<FeatureRedis>);
  now?: () => number;
  key?: () => Buffer | null;
  addressOf?: (headers: { get(name: string): string | null }) => string | undefined;
  principalOf?: (request: unknown) => RequestPrincipal | null;
  maxActors?: number;
  warn?: (text: string) => void;
  /** Hands a nomination to the firewall (the boot task: `emitSecuritySignal`); absent = no nominations. */
  emit?: ((signal: SecuritySignalInput) => boolean) | null;
}

const freshStats = (): FoldStats => ({
  observed: { proxy: 0, api: 0, asset: 0 }, written: 0, flushes: 0,
  dropped: { no_key: 0, no_address: 0, actor_cap: 0, command_cap: 0, endpoint_cap: 0, redis_unavailable: 0, flush_failed: 0, error: 0 },
  hints: { emitted: 0, capped: 0 },
});

const add = (c: Record<string, number>, field: string, n: number): void => {
  if (n) c[field] = (c[field] ?? 0) + n;
};
const addMember = (set: Set<string> | undefined | null, member: string | null): void => {
  if (set && member && set.size < MEMBERS_MAX) set.add(member);
};

/** Adds to an actor's day profile; a NEW field beyond PROFILE_FIELDS_MAX is left out (known ones still count), as PROFILE_SCRIPT does. */
function addProfile(a: ActorFold, field: string, n: number): void {
  const p = a.profile;
  if (!p || !n) return;
  if (field in p) { p[field] = (p[field] ?? 0) + n; return; }
  if (a.profileFields >= PROFILE_FIELDS_MAX) return;
  p[field] = n;
  a.profileFields += 1;
}

/** The counters one request adds to each of its actors. */
function addRequest(c: Record<string, number>, m: RequestMeta): void {
  add(c, 'rq', 1);
  add(c, `rc:${m.routeClass}`, 1);
  add(c, `st:${m.statusClass}`, 1);
  if (m.write) add(c, 'mw', 1);
  if (m.oddMethod) add(c, 'mo', 1);
  add(c, 'pd', m.pathDepth);
  add(c, 'pe', m.pathEntropy100);
  add(c, 'pc', m.paramCount);
  add(c, 'pb', m.paramBytes);
  add(c, 'bb', m.payloadBytes);
  add(c, 'rb', m.responseBytes);
  for (const k in m.indicators) add(c, `ix:${k}`, m.indicators[k as keyof RequestMeta['indicators']]);
  add(c, `ua:${m.uaFamily}`, 1);
  if (m.headerAnomalies > 0) { add(c, 'ha', m.headerAnomalies); add(c, 'hna', 1); }
  if (m.pageDepth !== null) { add(c, 'pg', m.pageDepth); add(c, 'pgn', 1); if (m.pageDepth >= DEEP_PAGE) add(c, 'pgd', 1); }
  if (m.adminAction) add(c, 'adm', 1);
  add(c, 'xb', m.exportBytes);
  if (m.authOutcome) add(c, `ar:${m.authOutcome}`, 1);
}

export class RequestFeatureFold {
  readonly stats: FoldStats = freshStats();
  private actors = new Map<string, ActorFold>();
  private track = new Map<string, Track>();
  private hinted = new Map<string, number>();
  private windowStart: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private redis: FeatureRedis | null = null;
  private lastWarn = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: RequestFoldOptions = {}) {}

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** The observer (synchronous). Never throws. */
  readonly observe = (obs: RequestObservation): void => {
    try {
      this.fold(obs);
    } catch {
      this.stats.dropped.error += 1;
    }
  };

  private actor(scope: string, kind: string, hash: string, baseline: boolean, ref: PatternActor | null = null): ActorFold | null {
    const id = `${scope}|${kind}|${hash}`;
    let a = this.actors.get(id);
    if (a) return a;
    if (this.actors.size >= (this.o.maxActors ?? MAX_ACTORS)) { this.stats.dropped.actor_cap += 1; return null; }
    a = {
      scope, kind, hash, counters: {}, distinct: {}, endpoints: null,
      profile: baseline ? {} : null, profileFields: 0, profileDistinct: baseline ? {} : null, role: null, ref: this.o.emit ? ref : null,
    };
    this.actors.set(id, a);
    return a;
  }

  /** Sequential ids and timing regularity need the actor's previous request; kept here, bounded, never written. */
  private trackStep(actorId: string, at: number, route: string | null, numericId: number | null): { seq: boolean; regular: boolean } {
    let t = this.track.get(actorId);
    if (!t) {
      if (this.track.size >= TRACK_MAX) this.track.clear();
      t = { lastId: null, lastRoute: null, lastAt: at, lastGap: -1 };
      this.track.set(actorId, t);
      t.lastId = numericId;
      t.lastRoute = route;
      return { seq: false, regular: false };
    }
    const gap = at - t.lastAt;
    const regular = t.lastGap > 0 && gap > 0 && gap <= REGULAR_GAP_MAX_MS && Math.abs(gap - t.lastGap) <= t.lastGap * REGULAR_GAP_SHARE;
    const seq = numericId !== null && t.lastId !== null && route !== null && route === t.lastRoute && Math.abs(numericId - t.lastId) === 1;
    t.lastGap = gap;
    t.lastAt = at;
    if (numericId !== null) { t.lastId = numericId; t.lastRoute = route; }
    return { seq, regular };
  }

  private fold(obs: RequestObservation): void {
    const key = (this.o.key ?? featureIdKey)();
    if (!key) { this.stats.dropped.no_key += 1; return; }
    const address = (this.o.addressOf ?? clientIpOf)(obs.request.headers);
    if (!address) { this.stats.dropped.no_address += 1; return; }
    const at = this.now();
    this.windowStart ??= at;
    const addressHash = featureIdOf('ip', address, key)!;

    if (obs.asset) {
      this.stats.observed.asset += 1;
      const a = this.actor(PLATFORM_SCOPE, 'ip', addressHash, false);
      if (a) add(a.counters, 'ast', 1);
      return;
    }
    this.stats.observed[obs.phase] += 1;

    const search = obs.request.nextUrl?.search ?? '';
    const meta = requestMetaOf({
      phase: obs.phase, method: obs.request.method, path: obs.path, search, headers: obs.request.headers,
      route: obs.route, status: obs.status, responseBytes: obs.responseBytes,
    });
    const routeTag = obs.route ? featureTagOf('route', obs.route, key) : null;

    const principal = obs.phase === 'api' ? (this.o.principalOf ?? requestPrincipalOf)(obs.request) : null;
    const tenantId = principal?.tenantId ?? obs.tenantId;
    let caller: ActorFold | null = null;
    let callerHash: string | null = null;
    const impersonating = principal?.impersonating === true;
    if (principal && tenantId) {
      const kind = principal.apiKeyId ? 'apiKey' : 'user';
      const id = principal.apiKeyId ?? principal.userId;
      callerHash = id ? featureIdOf(kind, id, key) : null;
      if (callerHash && id) {
        caller = this.actor(tenantScope(tenantId), kind, callerHash, !impersonating, { tenantId, kind, id, role: impersonating ? null : principal.role ?? null });
      }
    }
    const addr = this.actor(PLATFORM_SCOPE, 'ip', addressHash, false, { tenantId: null, kind: 'ip', id: address, role: null });

    for (const [a, actorId] of [[addr, `p|ip|${addressHash}`], [caller, `c|${callerHash}`]] as const) {
      if (!a) continue;
      addRequest(a.counters, meta);
      const step = this.trackStep(actorId, at, obs.route, meta.numericId);
      if (step.seq) add(a.counters, 'seq', 1);
      if (step.regular) add(a.counters, 'tr', 1);
      if (routeTag) {
        a.endpoints ??= new Set();
        addMember(a.endpoints, routeTag);
        addMember((a.distinct.ep ??= new Set()), routeTag);
      }
    }
    const sessionTag = caller && obs.route === STEP_UP_VERIFY_ROUTE && principal?.sessionId ? featureTagOf('session', principal.sessionId, key) : null;
    if (caller && sessionTag && obs.status !== null && obs.status >= 200 && obs.status < 300 && principal?.userId && tenantId && !impersonating) {
      add(caller.counters, `${STEP_UP_PROVED_PREFIX}${sessionTag}`, 1);
      try {
        listenerHolder[STEP_UP_LISTENER_KEY]?.({ tenantId, userId: principal.userId, sessionId: principal.sessionId ?? null });
      } catch {
        // the cascade's bookkeeping never changes the fold
      }
    }
    if (caller && addr) {
      addMember((addr.distinct.acct ??= new Set()), callerHash);
      addMember((caller.distinct.addr ??= new Set()), addressHash);
    }
    if (caller?.profile && !impersonating) {
      addProfile(caller, `h${String(new Date(at).getUTCHours()).padStart(2, '0')}`, 1);
      addProfile(caller, `v:${meta.routeClass}`, 1);
      addProfile(caller, 'xb', meta.exportBytes);
      if (meta.adminAction) addProfile(caller, 'adm', 1);
      const ua = obs.request.headers.get('user-agent');
      const device = ua ? featureTagOf('device', ua.slice(0, DEVICE_UA_MAX), key) : null;
      if (device) addProfile(caller, `d:${device}`, 1);
      addMember((caller.profileDistinct!.addr ??= new Set()), addressHash);
      if (principal?.role) caller.role = principal.role;
    }
  }

  /** Nominates the actors of this flush that are worth a look (see the header). Never throws. */
  private nominate(atMs: number): void {
    const emit = this.o.emit;
    if (!emit) return;
    const now = this.now();
    let sent = 0;
    for (const a of this.actors.values()) {
      if (!a.ref || !worthALook(a.counters)) continue;
      const id = `${a.scope}|${a.kind}|${a.hash}`;
      const last = this.hinted.get(id);
      if (last !== undefined && now - last < HINT_COOLDOWN_MS) continue;
      if (sent >= HINTS_PER_FLUSH) { this.stats.hints.capped += 1; continue; }
      let accepted = false;
      try {
        accepted = emit(requestPatternSignal({ ...a.ref, role: a.ref.role ?? a.role }, a.counters, atMs));
      } catch {
        accepted = false;
      }
      if (!accepted) { this.stats.hints.capped += 1; continue; }
      if (this.hinted.size >= TRACK_MAX) this.hinted.clear();
      this.hinted.set(id, now);
      this.stats.hints.emitted += 1;
      sent += 1;
    }
  }

  /** What the fold holds, as updates; the fold starts empty again. */
  drain(): FeatureUpdate[] {
    if (this.actors.size === 0) { this.windowStart = null; return []; }
    const atMs = this.windowStart ?? this.now();
    this.nominate(atMs);
    const out: FeatureUpdate[] = [];
    for (const a of this.actors.values()) {
      const distinct: Partial<Record<DistinctDim, string[]>> = {};
      const profileAddr = a.profileDistinct?.addr;
      for (const [dim, set] of Object.entries(a.distinct)) if (set?.size) distinct[dim as DistinctDim] = [...set];
      out.push({
        scope: a.scope, kind: a.kind, hash: a.hash, atMs, counters: a.counters, distinct,
        ...(a.endpoints?.size ? { endpoints: [...a.endpoints] } : {}),
        ...(a.profile ? { profile: { counters: a.profile, role: a.role, distinct: profileAddr?.size ? { addr: [...profileAddr] } : {} } } : {}),
      });
    }
    this.actors = new Map();
    this.windowStart = null;
    return out;
  }

  private async redisClient(): Promise<FeatureRedis> {
    if (this.redis) return this.redis;
    const r = this.o.redis;
    this.redis = typeof r === 'function' ? await r() : r ?? ((await import('@kuraykaraaslan-labs/redis')).default as unknown as FeatureRedis);
    return this.redis;
  }

  private warn(text: string): void {
    const now = this.now();
    if (now - this.lastWarn < 60_000) return;
    this.lastWarn = now;
    this.o.warn?.(`request features: ${text}`);
  }

  /** Writes what the fold holds. One flush at a time; never rejects. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const updates = this.drain();
    if (updates.length === 0) return Promise.resolve();
    this.flushing = (async () => {
      try {
        const result = await writeFeatureUpdates(await this.redisClient(), updates, this.now());
        this.stats.flushes += 1;
        this.stats.written += result.written;
        this.stats.dropped.command_cap += result.capped;
        this.stats.dropped.endpoint_cap += result.endpointsCapped ?? 0;
        if (result.commandErrors) this.warn(`${result.commandErrors} feature commands failed in one flush`);
      } catch (e) {
        this.stats.dropped[e instanceof FeatureRedisUnavailable ? 'redis_unavailable' : 'flush_failed'] += updates.length;
        this.warn(`a flush of ${updates.length} actors was dropped: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  start(intervalMs: number = FLUSH_INTERVAL_MS): this {
    if (this.timer) return this;
    this.timer = setInterval(() => { void this.flush(); }, intervalMs);
    this.timer.unref?.();
    return this;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }
}

/* ──────────────────────────────── The runtime boot task ──────────────────────────────── */

const CURRENT_KEY = Symbol.for('kuraykaraaslan-labs.ai_firewall.requestFeatureFold');
const holder = globalThis as unknown as Record<symbol, RequestFeatureFold | undefined>;

export function requestFeatureMetricSources(read: () => FoldStats | undefined = () => holder[CURRENT_KEY]?.stats): MetricSource[] {
  return [
    {
      name: 'ai_firewall_features_observed_total',
      help: 'Requests the AI firewall\'s feature store folded in this process, by where it saw them (proxy pages, API answers, assets).',
      labelNames: ['phase'],
      read: async () => (['proxy', 'api', 'asset'] as const).map((phase) => ({ labels: { phase }, value: read()?.observed[phase] ?? 0 })),
    },
    {
      name: 'ai_firewall_features_written_total',
      help: 'Actor updates the feature store wrote to Redis from this process.',
      labelNames: [],
      read: async () => [{ labels: {}, value: read()?.written ?? 0 }],
    },
    {
      name: 'ai_firewall_features_dropped_total',
      help: 'Requests or actor updates the feature store dropped (never retried, never felt by a request; FWA-7), by reason.',
      labelNames: ['reason'],
      read: async () => FOLD_DROP_REASONS.map((reason) => ({ labels: { reason }, value: read()?.dropped[reason] ?? 0 })),
    },
    {
      name: 'ai_firewall_feature_hints_total',
      help: 'Actors this process nominated to the detectors (one ai_firewall.request_pattern signal each), and nominations left out (per-flush cap or a refused emit).',
      labelNames: ['result'],
      read: async () => [
        { labels: { result: 'emitted' }, value: read()?.hints.emitted ?? 0 },
        { labels: { result: 'capped' }, value: read()?.hints.capped ?? 0 },
      ],
    },
  ];
}

/**
 * `common:boot_task` (runtime phase, every process): registers the fold as the request observer and starts its flush timer, puts its
 * series on `/metrics` and flushes it on drain. In the worker nothing calls the observer and nothing is written. Idempotent.
 */
export async function startRequestFeatures(): Promise<{ stop(): Promise<void> }> {
  const running = holder[CURRENT_KEY];
  if (running) return { stop: () => running.stop() };
  const { emitSecuritySignal } = await import('@kuraykaraaslan-labs/common/server/common.firewall-contracts');
  const fold = new RequestFeatureFold({ warn: (text) => Logger.warn(`[ai_firewall] ${text}`), emit: emitSecuritySignal }).start();
  holder[CURRENT_KEY] = fold;
  setRequestObserver(fold.observe);
  const { registerDrainHook, registerMetricSource } = await import('@kuraykaraaslan-labs/common/server/process-hooks');
  const sources = requestFeatureMetricSources();
  for (const s of sources) registerMetricSource(s);
  try {
    const { registerGaugeSource } = await import('@kuraykaraaslan-labs/observability/server/metrics');
    for (const s of sources) registerGaugeSource(s);
  } catch {
    // the worker has no observability registry; process_host serves the sources above
  }
  const stop = async () => {
    setRequestObserver(null);
    await fold.stop();
    if (holder[CURRENT_KEY] === fold) holder[CURRENT_KEY] = undefined;
  };
  registerDrainHook('ai-firewall-request-features', stop);
  return { stop };
}
