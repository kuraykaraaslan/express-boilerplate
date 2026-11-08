/**
 * Phase 55 00.5 (P-5): API key refusals feed a strike store keyed on the CREDENTIAL, never on the caller's address (38 L-4: an API key
 * is a machine lane; carrier and site NAT put whole fleets of integrations behind one address). The design is the address strike store's
 * (limiter.ip-strikes.ts: a counted window, an offense memory that doubles the penalty, an index of the active penalties), keyed on the
 * key id. What the strikes earn is a FLAG, not a penalty:
 *
 *  - `KEY_STRIKE_THRESHOLD` (20) counted refusals of one key within `KEY_STRIKE_WINDOW_SECONDS` (10 min) flag the key for
 *    `KEY_THROTTLE_BASE_SECONDS` (15 min), doubled per repeat within `KEY_OFFENSE_MEMORY_SECONDS` (7 days), capped at
 *    `KEY_THROTTLE_MAX_SECONDS` (24 h): one `api_key.throttled` row (high, `enforced: false`, so the `audit.high_risk` webhook and the
 *    alert rules see it) and a readable record (`getKeyThrottle`, `listKeyThrottles`) for the firewall and a later screen; lifting it
 *    early (`clearKeyThrottle`, the firewall's undo, FWA-4) writes `api_key.throttle_cleared`.
 *  - A flag never narrows the key's limit on its own (phase 55 00.5 review, FWA-5). Every counted refusal is already refused by verify
 *    before the limit is read (`inactive`, `expired`, `creator_not_member`) or refused by the allowlist (`ip_denied`), so the only calls a
 *    strike-earned throttle could slow are the rightful integration's own, from its allowed addresses: whoever leaked the key, already
 *    stopped by the allowlist, could cap the real integration at will. The throttle is ENFORCED only when someone decides it on evidence
 *    the key's own accepted calls produce (`enforceKeyThrottle`: the firewall's or an administrator's decision): then the key's
 *    per-minute limit is at most `KEY_THROTTLED_RATE_LIMIT_PER_MINUTE` (10) until it ends, a trickle rather than a cut-off.

 * What counts (`STRIKE_REASONS`): refusals that say something about who holds the credential: a revoked (`inactive`) or `expired` key
 * still presented, a key used from outside its address allowlist (`ip_denied`), a key whose creator left (`creator_not_member`).
 * What does not: a key presented to another tenant (`wrong_tenant`; verify promises such a call leaves no trace on the key), a
 * suspended workspace (`tenant_inactive`, a tenant state, not the key's), authorization refusals (`insufficient_scope`,
 * `insufficient_permission`, `module_disabled`, `no_holder`: an integration calling one endpoint it was not given must not lose the
 * rest), the rate limit and the throttle themselves (`rate_limited`, `throttled`: counting them would make the throttle feed itself),
 * and an unknown key (`unknown_key`: there is no credential to key on, and a per-address strike is exactly what L-4 forbids).
 *
 * Everything is best-effort and bounded: a strike that cannot be counted is logged, and a throttle that cannot be read is treated as
 * none (the per-key rate limit still holds, with its own per-process fallback).
 */
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';

export const KEY_STRIKE_THRESHOLD = 20;
export const KEY_STRIKE_WINDOW_SECONDS = 10 * 60;
export const KEY_THROTTLE_BASE_SECONDS = 15 * 60;
export const KEY_THROTTLE_MAX_SECONDS = 24 * 60 * 60;
export const KEY_OFFENSE_MEMORY_SECONDS = 7 * 24 * 60 * 60;
export const KEY_THROTTLED_RATE_LIMIT_PER_MINUTE = 10;
export const KEY_STRIKE_REDIS_TIMEOUT_MS = 250;
export const KEY_THROTTLE_LIST_MAX = 1_000;

/** The refusal reasons that strike the key (see the file header for why the others do not). */
export const STRIKE_REASONS: ReadonlySet<string> = new Set(['inactive', 'expired', 'ip_denied', 'creator_not_member']);

export const keyStrikeKey = (apiKeyId: string) => `api_key:strike:${apiKeyId}`;
export const keyOffenseKey = (apiKeyId: string) => `api_key:offense:${apiKeyId}`;
export const keyThrottleKey = (apiKeyId: string) => `api_key:throttle:${apiKeyId}`;
/** Sorted set of the throttled key ids, score = the throttle's end (ms); trimmed by `listKeyThrottles`. */
export const KEY_THROTTLE_INDEX = 'api_key:throttles';

export type KeyThrottle = {
  apiKeyId: string;
  tenantId: string;
  offense: number;
  /** The refusal that crossed the threshold. */
  reason: string;
  strikes: number;
  throttledAt: number;
  until: number;
  limitPerMinute: number;
  /** True only for a throttle someone decided (`enforceKeyThrottle`); a strike-earned record is a flag and narrows nothing. */
  enforced: boolean;
};

function bounded<T>(work: Promise<T> | T, ms = KEY_STRIKE_REDIS_TIMEOUT_MS): Promise<T> {
  const pending = Promise.resolve(work);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`redis did not answer within ${ms} ms`)), ms);
  });
  pending.catch(() => {});
  return Promise.race([pending, bound]).finally(() => clearTimeout(timer));
}

/** Throttle length for the nth throttle (1-based): the base doubled per repeat, capped. Pure. */
export function keyThrottleSecondsFor(offense: number): number {
  const n = Math.max(1, Math.floor(Number.isFinite(offense) ? offense : 1));
  return Math.min(KEY_THROTTLE_MAX_SECONDS, KEY_THROTTLE_BASE_SECONDS * 2 ** Math.min(n - 1, 30));
}

/** A stored throttle, or null when the value is not one (anything else under the key admits the normal limit, never a wider one). */
function parseThrottle(raw: unknown): KeyThrottle | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<KeyThrottle> | null;
    if (!v || typeof v !== 'object' || typeof v.apiKeyId !== 'string' || typeof v.tenantId !== 'string') return null;
    if (![v.offense, v.strikes, v.throttledAt, v.until, v.limitPerMinute].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return {
      apiKeyId: v.apiKeyId, tenantId: v.tenantId, offense: v.offense!, reason: typeof v.reason === 'string' ? v.reason : 'unknown',
      strikes: v.strikes!, throttledAt: v.throttledAt!, until: v.until!, limitPerMinute: v.limitPerMinute!,
      // A record without the field (written before the flag split, or by hand) is a flag: it never narrows a key on its own.
      enforced: v.enforced === true,
    };
  } catch {
    return null;
  }
}

/**
 * The key's active throttle, or null. Fails open (null) when Redis cannot answer: the verification path must not turn a Redis outage
 * into an outage of every key, and the per-key rate limit keeps holding without it.
 */
export async function getKeyThrottle(apiKeyId: string): Promise<KeyThrottle | null> {
  try {
    const t = parseThrottle(await bounded(redis.get(keyThrottleKey(apiKeyId))));
    return t && t.until > Date.now() ? t : null;
  } catch {
    return null;
  }
}

/** The per-minute limit a key gets: its normal limit, or the throttled ceiling while an ENFORCED throttle holds (a flag changes nothing). Pure. */
export function effectiveKeyLimit(limitPerMinute: number, throttle: KeyThrottle | null): number {
  if (!throttle || throttle.enforced !== true) return limitPerMinute;
  const normal = limitPerMinute > 0 ? limitPerMinute : Number.POSITIVE_INFINITY;
  return Math.min(normal, throttle.limitPerMinute);
}

/**
 * One refusal of a known key. Counts it when its reason is one of `STRIKE_REASONS` and flags the key at the threshold (a record that
 * narrows nothing, see the header). Never throws; answers the flag this strike started, or null. Not keyed on, and never reading, the
 * caller's address.
 */
export async function recordKeyStrike(apiKeyId: string | null | undefined, tenantId: string | null | undefined, reason: string): Promise<KeyThrottle | null> {
  if (!apiKeyId || !tenantId || !STRIKE_REASONS.has(reason)) return null;
  try {
    const strikeKey = keyStrikeKey(apiKeyId);
    const strikes = Number(await bounded(redis.incr(strikeKey)));
    if (strikes === 1) await bounded(redis.expire(strikeKey, KEY_STRIKE_WINDOW_SECONDS));
    if (!(strikes >= KEY_STRIKE_THRESHOLD)) return null;
    // A key already throttled is not throttled again (the strikes of a throttled key only keep counting toward the next one).
    if (await getKeyThrottle(apiKeyId)) return null;
    return await throttleKey(apiKeyId, tenantId, reason, strikes);
  } catch (err) {
    Logger.warn(`[api_key.strikes] strike not recorded: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function throttleKey(apiKeyId: string, tenantId: string, reason: string, strikes: number): Promise<KeyThrottle | null> {
  const offenseKey = keyOffenseKey(apiKeyId);
  const offense = Number(await bounded(redis.incr(offenseKey))) || 1;
  await bounded(redis.expire(offenseKey, KEY_OFFENSE_MEMORY_SECONDS));
  const seconds = keyThrottleSecondsFor(offense);
  const now = Date.now();
  const throttle: KeyThrottle = {
    apiKeyId, tenantId, offense, reason, strikes, throttledAt: now, until: now + seconds * 1000, limitPerMinute: KEY_THROTTLED_RATE_LIMIT_PER_MINUTE,
    enforced: false,
  };
  const set = await bounded(redis.set(keyThrottleKey(apiKeyId), JSON.stringify(throttle), 'EX', seconds, 'NX'));
  if (set !== 'OK') return null; // another process flagged it first
  await bounded(redis.del(keyStrikeKey(apiKeyId))).catch(() => 0);
  await indexThrottle(throttle);
  Logger.warn(`[api_key.strikes] key ${apiKeyId} flagged for ${seconds}s after ${strikes} refusals (last: ${reason}, offense ${offense})`);
  AuditLogService.log({
    tenantId,
    actorType: 'SYSTEM',
    action: AuditActions.API_KEY_THROTTLED,
    resourceType: 'ApiKey',
    resourceId: apiKeyId,
    metadata: {
      reason,
      strikes,
      offense,
      seconds,
      until: new Date(throttle.until).toISOString(),
      limitPerMinute: KEY_THROTTLED_RATE_LIMIT_PER_MINUTE,
      enforced: false,
    },
  }).catch(() => {});
  return throttle;
}

async function indexThrottle(throttle: KeyThrottle): Promise<void> {
  try {
    await bounded(redis.zadd(KEY_THROTTLE_INDEX, throttle.until, throttle.apiKeyId));
    await bounded(redis.expire(KEY_THROTTLE_INDEX, KEY_THROTTLE_MAX_SECONDS));
  } catch (err) {
    Logger.warn(`[api_key.strikes] throttle index not updated: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A DECIDED throttle (the firewall's execute or an administrator's, on evidence the key's own accepted calls produced, FWA-5): at most
 * `KEY_THROTTLED_RATE_LIMIT_PER_MINUTE` calls a minute for `seconds` (default the base, capped at `KEY_THROTTLE_MAX_SECONDS`). Replaces
 * a flag or an earlier throttle of the key; the offense memory is not touched (it counts earned flags). Audited `api_key.throttled`
 * with `enforced: true` and the source. Throws when Redis cannot answer, so the decision is never reported done when it is not.
 */
export async function enforceKeyThrottle(
  apiKeyId: string,
  input: { tenantId: string; actorId?: string | null; source?: 'admin' | 'firewall'; seconds?: number; reason?: string },
): Promise<KeyThrottle> {
  const asked = Number.isFinite(input.seconds) ? Math.floor(input.seconds!) : KEY_THROTTLE_BASE_SECONDS;
  const seconds = Math.min(KEY_THROTTLE_MAX_SECONDS, Math.max(60, asked));
  const now = Date.now();
  const throttle: KeyThrottle = {
    apiKeyId, tenantId: input.tenantId, offense: 0, reason: input.reason ?? 'decided', strikes: 0, throttledAt: now, until: now + seconds * 1000,
    limitPerMinute: KEY_THROTTLED_RATE_LIMIT_PER_MINUTE, enforced: true,
  };
  await bounded(redis.set(keyThrottleKey(apiKeyId), JSON.stringify(throttle), 'EX', seconds));
  await indexThrottle(throttle);
  const source = input.source ?? (input.actorId ? 'admin' : 'firewall');
  AuditLogService.log({
    tenantId: input.tenantId,
    actorId: input.actorId ?? null,
    actorType: input.actorId ? 'USER' : 'SYSTEM',
    action: AuditActions.API_KEY_THROTTLED,
    resourceType: 'ApiKey',
    resourceId: apiKeyId,
    metadata: {
      reason: throttle.reason, seconds, until: new Date(throttle.until).toISOString(), limitPerMinute: KEY_THROTTLED_RATE_LIMIT_PER_MINUTE,
      enforced: true, source,
    },
  }).catch(() => {});
  return throttle;
}

/**
 * The keys throttled now, the one that ends last first, at most `limit`. Ended entries are trimmed from the index. Unlike the
 * verification read this does not fail open: a Redis failure throws, so a screen can say "unavailable" instead of "none".
 */
export async function listKeyThrottles(limit = 200): Promise<KeyThrottle[]> {
  const cap = Math.min(KEY_THROTTLE_LIST_MAX, Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0)));
  if (cap === 0) return [];
  const now = Date.now();
  await bounded(redis.zremrangebyscore(KEY_THROTTLE_INDEX, '-inf', now));
  const ids = (await bounded(redis.zrange(KEY_THROTTLE_INDEX, -cap, -1))) as string[];
  if (ids.length === 0) return [];
  const values = (await bounded(redis.mget(...ids.map(keyThrottleKey)))) as Array<string | null>;
  return values
    .map(parseThrottle)
    .filter((t): t is KeyThrottle => !!t && t.until > now)
    .sort((a, b) => b.until - a.until || (a.apiKeyId < b.apiKeyId ? -1 : a.apiKeyId > b.apiKeyId ? 1 : 0))
    .slice(0, cap);
}

/**
 * Lifts a key's throttle before it ends and forgets its strikes and offense memory (an administrator's decision or the firewall's undo).
 * Audited `api_key.throttle_cleared` when a throttle was lifted. Throws when Redis cannot answer.
 */
export async function clearKeyThrottle(
  apiKeyId: string,
  input: { tenantId: string; actorId?: string | null; source?: 'admin' | 'firewall' },
): Promise<boolean> {
  const removed = Number(await bounded(redis.del(keyThrottleKey(apiKeyId)))) > 0;
  await bounded(redis.zrem(KEY_THROTTLE_INDEX, apiKeyId)).catch(() => 0);
  await bounded(redis.del(keyStrikeKey(apiKeyId), keyOffenseKey(apiKeyId))).catch(() => 0);
  if (removed) {
    AuditLogService.log({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action: AuditActions.API_KEY_THROTTLE_CLEARED,
      resourceType: 'ApiKey',
      resourceId: apiKeyId,
      metadata: { source: input.source ?? (input.actorId ? 'admin' : 'firewall') },
    }).catch(() => {});
  }
  return removed;
}
