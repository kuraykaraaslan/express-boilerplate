import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { REDIS_IDEMPOTENCY_SETTING_KEYS } from './redis_idempotency.setting.keys';

/**
 * How long the installation keeps Idempotency-Key claims (2026-10-27), read from the ROOT tenant: the claims live in the
 * installation's Redis and its `idempotency_claims` table, so the times are the platform operator's and a value in any other tenant
 * is never read. Each key can only LENGTHEN the built-in time, so a duplicate request is never run sooner than today; unset, junk, a
 * value at or below the built-in one, or a failed read keeps it exactly.
 *
 * - `idempotencyReplayHours`: how long a completed request is remembered (its response replayed to the same caller, any other use of
 *   the key refused), in Redis and in the durable store, was the constant 24 hours (`TTL_SECONDS`). 24..168: a client that queues
 *   writes offline for days (a mobile app) can retry them with the same key without running them twice.
 * - `idempotencyPendingMinutes`: how long an in-flight claim blocks a duplicate (409) before a retry may run, was the constant 10
 *   minutes (`PENDING_TTL_SECONDS`, redis_idempotency.02). 10..60: for handlers that may run longer than 10 minutes. A claim whose
 *   process died blocks its key for as long.
 *
 * The values are cached in process for `IDEMPOTENCY_POLICY_CACHE_MS`; the first read of a process is awaited for at most
 * `FIRST_READ_TIMEOUT_MS` (then the built-in times), later reads answer from the cache and refresh it in the background, one read at a
 * time. A failed read keeps the last values read (the built-in ones before any). The settings service never calls this store.
 */

export const IDEMPOTENCY_POLICY_CACHE_MS = 60_000;
export const FIRST_READ_TIMEOUT_MS = 250;

// Captured at load, like the durable store's timer, so a test's fake clock cannot stall the first read.
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);

/** `floor` is the built-in time (a value at or below it changes nothing), `ceiling` the longest. */
export const REPLAY_HOURS_RANGE = { floor: 24, ceiling: 7 * 24 } as const;
export const PENDING_MINUTES_RANGE = { floor: 10, ceiling: 60 } as const;

export interface IdempotencyPolicy {
  /** Seconds a completed record is kept. */
  completedTtlSeconds: number;
  /** Seconds a pending claim is kept. */
  pendingTtlSeconds: number;
}

export const DEFAULT_IDEMPOTENCY_POLICY: IdempotencyPolicy = Object.freeze({
  completedTtlSeconds: REPLAY_HOURS_RANGE.floor * 3600,
  pendingTtlSeconds: PENDING_MINUTES_RANGE.floor * 60,
});

/** A whole number that can only raise the built-in `floor`: unset, junk or at most the floor -> the floor; above the ceiling -> the ceiling. */
export function raiseOnly(raw: string | null | undefined, floor: number, ceiling: number): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,9}$/.test(v)) return floor;
  return Math.min(ceiling, Math.max(floor, Number(v)));
}

export function parseIdempotencyPolicy(s: Record<string, string | null | undefined>): IdempotencyPolicy {
  return {
    completedTtlSeconds: raiseOnly(s.idempotencyReplayHours, REPLAY_HOURS_RANGE.floor, REPLAY_HOURS_RANGE.ceiling) * 3600,
    pendingTtlSeconds: raiseOnly(s.idempotencyPendingMinutes, PENDING_MINUTES_RANGE.floor, PENDING_MINUTES_RANGE.ceiling) * 60,
  };
}

let cache: { at: number; policy: IdempotencyPolicy } | null = null;
let inflight: Promise<IdempotencyPolicy> | null = null;

/** Drops the cached policy (tests). */
export function resetIdempotencyPolicyCache(): void {
  cache = null;
  inflight = null;
}

async function load(): Promise<IdempotencyPolicy> {
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    return parseIdempotencyPolicy((await SettingService.getByKeys(ROOT_TENANT_ID, [...REDIS_IDEMPOTENCY_SETTING_KEYS])) ?? {});
  } catch {
    return cache?.policy ?? DEFAULT_IDEMPOTENCY_POLICY;
  }
}

function refresh(): Promise<IdempotencyPolicy> {
  if (!inflight) {
    const run = load().then((policy) => {
      if (inflight === run) cache = { at: performance.now(), policy };
      return policy;
    });
    inflight = run;
    void run.finally(() => { if (inflight === run) inflight = null; });
  }
  return inflight;
}

/** The installation's claim times, cached (see the header). Never throws. */
export async function getIdempotencyPolicy(): Promise<IdempotencyPolicy> {
  if (cache) {
    if (performance.now() - cache.at >= IDEMPOTENCY_POLICY_CACHE_MS) void refresh();
    return cache.policy;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      refresh(),
      new Promise<IdempotencyPolicy>((resolve) => { timer = realSetTimeout(() => resolve(DEFAULT_IDEMPOTENCY_POLICY), FIRST_READ_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) realClearTimeout(timer);
  }
}
