import Logger from '@kuraykaraaslan-labs/logger';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { featureGateEntitlementCeilingLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/feature_gate.entitlement_ceiling';
import { FEATURE_GATE_MESSAGES } from './feature_gate.messages';
import type { EntitlementCeilingProvider, EntitlementFeature } from './feature_gate.types';
import { parseLimitValue } from './feature_gate.limit-value';

/**
 * The deployment-wide entitlement CEILING (fleet step 3b.10, decision F23, owner rule S11).
 *
 * `feature_gate:entitlement_source` is additive by contract: a second source can only widen what a tenant holds. A
 * license that must CAP features (the stricter of the tenant's plan and the deployment's license) therefore cannot be a
 * source; it would be a grant. This is a separate point, applied after the additive merge as a minimum:
 *
 * - BOOLEAN: on only when both the plan and the ceiling say on.
 * - LIMIT: the smaller of the two; `-1` (unlimited) loses to any finite value.
 * - A key the ceiling does not name is untouched, and with no contributor (or every contributor answering `null`)
 *   nothing changes at all. A ceiling never grants: it is never consulted for a key the plan refuses, and on a key the
 *   plan never declared it can only add a refusal (see {@link capFeature}).
 *
 * Deployment-wide, so it is asked in a system context and kept in a short in-process memo rather than in every
 * tenant's Redis entry: the per-tenant cache stays the plan's answer and the cap is applied on every check, so a new
 * license caps every tenant at once without dropping a single tenant key. {@link invalidateEntitlementCeiling} drops the
 * memo (the license module calls it on install, removal and every lease write).
 *
 * A contributor that THROWS (or does not answer within {@link CEILING_TIMEOUT_MS}) answers its own `baseline()` instead,
 * the un-licensed Core defaults (S11 rule 5). Not deny-all: a provider bug must not take every tenant on the deployment
 * down. A contributor whose module cannot even be loaded (or whose baseline throws, or that the extension breaker has
 * paused) has no baseline to give, so the last ceiling this process resolved is applied instead; only when nothing has
 * answered since the process started does the check fail closed (500) like a source that cannot answer: a broken build,
 * not a license that said no.
 */

/** Extension point id — declared in feature_gate/module.json `extensionPoints`. */
export const FEATURE_GATE_CEILING_POINT = 'feature_gate:entitlement_ceiling';

/** How long a contributor's `ceiling()` may take before its baseline is used. Below the point's aggregate timeout, so the fallback always runs. */
export const CEILING_TIMEOUT_MS = 2000;

/** Memo lifetime. Short, because only this process's writes invalidate it (another replica's install is seen within this window plus the license's own status cache). */
export const CEILING_MEMO_MS = 10_000;

/**
 * Memo lifetime of a DEGRADED answer (a contributor answered its baseline). Much shorter, so a recovered provider is
 * asked again almost at once, but not zero: a provider that hangs would otherwise add {@link CEILING_TIMEOUT_MS} to
 * every single feature check on the deployment while it is down.
 */
export const CEILING_DEGRADED_MEMO_MS = 1_000;

/** The combined ceiling: one capping feature per key, or `null` when nothing caps anything. */
export type Ceiling = ReadonlyMap<string, EntitlementFeature> | null;

/** Marker for "the plan side grants everything" (no source installed, or a wildcard arrangement). */
export const GRANTS_ALL = Symbol('grantsAll');

const isInt = (v: string): boolean => /^-?\d+$/.test(v) && Number.isSafeInteger(Number(v));

/** A capping feature the gate can apply; anything else is dropped (and logged) instead of being guessed at. */
export function isValidCap(f: unknown): f is EntitlementFeature {
  if (!f || typeof f !== 'object') return false;
  const { key, type, value } = f as Record<string, unknown>;
  if (typeof key !== 'string' || key.length === 0 || typeof value !== 'string') return false;
  if (type === 'BOOLEAN') return value === 'true' || value === 'false';
  if (type === 'LIMIT') return isInt(value) && Number(value) >= -1;
  return false;
}

const limitOf = (f: EntitlementFeature): number => Number(f.value);

/** The stricter of two caps for one key; two caps of different types refuse (a ceiling bug never widens). */
function stricter(a: EntitlementFeature, b: EntitlementFeature): EntitlementFeature {
  if (a.type !== b.type) return { key: a.key, type: 'BOOLEAN', value: 'false' };
  if (a.type === 'BOOLEAN') return a.value === 'true' ? b : a;
  const x = limitOf(a);
  const y = limitOf(b);
  if (x === -1) return b;
  if (y === -1) return a;
  return y < x ? b : a;
}

/** Combine every contributor's answer into one ceiling: per key, the strictest cap. `null` answers contribute nothing. */
export function combineCeilings(answers: ReadonlyArray<ReadonlyArray<unknown> | null>): Ceiling {
  const byKey = new Map<string, EntitlementFeature>();
  let any = false;
  for (const answer of answers) {
    if (answer === null) continue;
    any = true;
    for (const f of answer) {
      if (!isValidCap(f)) {
        Logger.warn(`[feature_gate] ${FEATURE_GATE_MESSAGES.CEILING_ENTRY_IGNORED}: ${JSON.stringify(f)}`);
        continue;
      }
      const seen = byKey.get(f.key);
      byKey.set(f.key, seen ? stricter(seen, f) : { key: f.key, type: f.type, value: f.value });
    }
  }
  return any ? byKey : null;
}

/** The grace arithmetic of `checkFeatureAccess`, for a finite limit. */
export function graceCeiling(limit: number, gracePercent = 0): number {
  return limit + Math.floor(limit * gracePercent / 100);
}

/**
 * Apply one key's cap to what the plan side answered.
 *
 * `base` is the merged plan feature, {@link GRANTS_ALL} when the plan side grants everything, or `undefined` when a
 * live plan never declared the key. The result is the feature the gate's arithmetic then runs on (`undefined` keeps
 * the "never declared" refusal).
 *
 * The undeclared case is the subtle one. Callers read an undeclared key two ways: strict callers refuse it, lenient
 * ones (`declared && !allowed` gates, "undeclared means unlimited" limits) allow it. A cap must not grant to the
 * first kind (S11 rule 1) and must still bind the second, so on an undeclared key it only ever ADDS a refusal: a
 * BOOLEAN `false` becomes a declared refusal, and a finite LIMIT becomes a refused LIMIT answer once `currentCount` has
 * reached it (below the cap the undeclared answer stands). Anything else leaves the key undeclared.
 */
export function capFeature(
  base: EntitlementFeature | typeof GRANTS_ALL | undefined,
  cap: EntitlementFeature | undefined,
  currentCount?: number,
  gracePercent = 0,
): EntitlementFeature | typeof GRANTS_ALL | undefined {
  if (!cap) return base;
  if (base === GRANTS_ALL) return cap;
  if (base === undefined) {
    if (cap.type === 'BOOLEAN') return cap.value === 'false' ? cap : undefined;
    const n = limitOf(cap);
    if (n === -1) return undefined;
    if (n === 0) return { key: cap.key, type: 'BOOLEAN', value: 'false' };
    return currentCount !== undefined && currentCount >= graceCeiling(n, gracePercent) ? cap : undefined;
  }
  if (base.type !== cap.type) {
    // A catalogue/ceiling type mismatch: only an outright "off" (false, or a limit of 0) is applied, as a refusal.
    const off = cap.type === 'BOOLEAN' ? cap.value === 'false' : limitOf(cap) === 0;
    return off ? { key: base.key, type: 'BOOLEAN', value: 'false' } : base;
  }
  if (base.type === 'BOOLEAN') return base.value === 'true' && cap.value === 'true' ? base : { ...base, value: 'false' };
  const plan = parseLimitValue(base.value);
  if (!Number.isFinite(plan)) return base;
  const c = limitOf(cap);
  if (c === -1) return base;
  if (plan === -1 || c < plan) return { ...base, value: String(c) };
  return base;
}

type Outcome = { ceiling: Ceiling } | { error: Error };

/** The memoised outcome, stamped when the resolution FINISHED (a 2 s hang must not leave an already expired 1 s memo). */
let memo: { at: number; ttl: number; generation: number; outcome: Outcome } | null = null;
/** The resolution in progress, shared by every check that misses the memo (no stampede on expiry). */
let inFlight: { generation: number; promise: Promise<Outcome> } | null = null;
/** Bumped by every invalidation; a resolution that started before it neither memoises nor answers later checks. */
let generation = 0;
/** The last ceiling every contributor answered in this process: the fallback when one cannot answer at all. */
let lastGood: { ceiling: Ceiling } | null = null;

/**
 * Forget the memoised ceiling, so the next check asks the contributors again. Local to this process. A resolution
 * already running when this is called is discarded: it may have read the previous license.
 */
export function invalidateEntitlementCeiling(): void {
  generation += 1;
  memo = null;
  inFlight = null;
}

/** Drop every piece of process state, the fault fallback included. For tests. */
export function resetEntitlementCeiling(): void {
  invalidateEntitlementCeiling();
  lastGood = null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The deployment's current ceiling. A contributor that throws or hangs answers its baseline, memoised for
 * {@link CEILING_DEGRADED_MEMO_MS} only. A contributor that cannot answer at all (its module does not load, its
 * baseline throws, or the extension breaker has paused it after repeated such failures) gives the last ceiling every
 * contributor answered in this process, also for {@link CEILING_DEGRADED_MEMO_MS}: a contributor fault must not take
 * every tenant down for the breaker's cooldown (F23). Only when nothing ever answered in this process does it throw
 * (the check fails closed, 500), and that failure is memoised for the same short window so every check does not retry
 * the load.
 *
 * `clock` is injectable for tests; the memo is stamped with it after the contributors answered.
 */
export async function resolveCeiling(clock: () => number = Date.now): Promise<Ceiling> {
  if (memo && memo.generation === generation && clock() - memo.at < memo.ttl) return unwrap(memo.outcome);
  if (!inFlight || inFlight.generation !== generation) {
    const started = generation;
    const promise = resolveFresh(started, clock).finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });
    inFlight = { generation: started, promise };
  }
  return unwrap(await inFlight.promise);
}

function unwrap(outcome: Outcome): Ceiling {
  if ('error' in outcome) throw outcome.error;
  return outcome.ceiling;
}

async function resolveFresh(started: number, clock: () => number): Promise<Outcome> {
  let degraded = false;
  let outcome: Outcome;
  try {
    const { results, failed } = await ext.aggregate<EntitlementCeilingProvider, ReadonlyArray<unknown> | null>(
      FEATURE_GATE_CEILING_POINT, systemCtx('feature_gate entitlement ceiling'), featureGateEntitlementCeilingLoaders,
      async (provider, _signal, contribution) => {
        try {
          return await withTimeout(Promise.resolve().then(() => provider.ceiling()), CEILING_TIMEOUT_MS);
        } catch (error) {
          degraded = true;
          Logger.error(`[feature_gate] ${FEATURE_GATE_MESSAGES.CEILING_BASELINE_APPLIED} (${contribution.moduleId}): ${error instanceof Error ? error.message : String(error)}`);
          return provider.baseline();
        }
      },
    );
    if (failed.length) {
      throw new Error(`entitlement ceiling could not answer: ${failed.map((f) => `${f.moduleId} (${f.reason}: ${f.message})`).join(', ')}`);
    }
    outcome = { ceiling: combineCeilings(results.map((r) => r.value)) };
    if (started === generation) lastGood = { ceiling: outcome.ceiling };
  } catch (error) {
    degraded = true;
    const message = error instanceof Error ? error.message : String(error);
    if (lastGood) {
      Logger.error(`[feature_gate] ${FEATURE_GATE_MESSAGES.CEILING_LAST_GOOD_APPLIED}: ${message}`);
      outcome = { ceiling: lastGood.ceiling };
    } else {
      outcome = { error: error instanceof Error ? error : new Error(message) };
    }
  }
  // An invalidation while this ran (a license write) makes the answer suspect: it is returned to the checks that were
  // already waiting on it, which started before the write, but never memoised.
  if (started === generation) {
    memo = { at: clock(), ttl: degraded ? CEILING_DEGRADED_MEMO_MS : CEILING_MEMO_MS, generation: started, outcome };
  }
  return outcome;
}
