import { createHash } from 'node:crypto';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import ObservabilityService from '@kuraykaraaslan-labs/observability';
import { env } from '@kuraykaraaslan-labs/env';
import { LIMITER_REDIS_TIMEOUT_MS, withinRedisBound } from './limiter.redis-bound';
import { BUCKET_SCRIPT, REDIS_CLOCK, SIGNED_IN_SCRIPT, activeUserSlots, type LimiterScript } from './limiter.gcra';

/** Seconds: the period every rate below is measured over ("per minute"), and the wait a fail-closed refusal reports. */
export const RATE_LIMIT_WINDOW = 60;

/**
 * Requests per minute per client address, per scope (D40-10(e): unchanged by the token buckets). Each bucket also admits this many at
 * once (its burst, one minute's worth) and then one every 60 s / limit.
 */
export const LIMITS = {
  auth: 20,
  api: 120,
  // Public, Redis-served UI texts (translation's guest routes). A counter of its own so
  // downloading a language never spends the app's `api` budget, and five times that
  // budget because one download is a burst (1 + one request per module, 16 today) and
  // many devices can share one address (office Wi-Fi, carrier NAT).
  i18n: 600,
  // D40-14: the browser's CSP violation reports (seo's report route), anonymous by nature and sent in bursts (one per blocked inline
  // tag). Their own counter, so they never spend a person's `api` budget.
  csp: 120,
} as const;

export type LimiterScope = keyof typeof LIMITS;

/** D40-10(b): a signed-in person's `api` requests, whatever address they come from. */
export const USER_API_LIMIT = { perMinute: 240, burst: 120 } as const;

/**
 * D40-10(c): the ceiling of all signed-in `api` traffic from one address: `base` plus `perUser` for each user active from it in the
 * last 10 minutes (the current and the previous 10-minute slot), at most `max` a minute. An office behind one address is many people;
 * the address is still capped: sustained traffic converges on the ceiling, a minute from rest admits at most its burst on top.
 * The burst is `burstSeconds` of its rate, a full minute: a bucket's state is time, so the first person's whole burst (120 requests
 * at that person's ceiling of 240 a minute, 30 s) uses half of it and the next colleague still finds room at once; with half a
 * minute that one burst would fill it.
 */
export const ADDRESS_CEILING = { base: 120, perUser: 120, max: 3000, burstSeconds: 60 } as const;

/** The scopes that refuse when Redis cannot answer (limiter.01: the credential surface; D40-14: anonymous reports that write logs). */
const FAIL_CLOSED_SCOPES: ReadonlySet<LimiterScope> = new Set<LimiterScope>(['auth', 'csp']);

// Every key of the token buckets is under `rate:` (the fixed window's INCR counters were `rate_limit:`, a different value type: a new
// name keeps a rolling deploy's old and new code off each other's keys). The second segment is a scope for `check` and never one for
// the per-person, per-address and per-session keys, so no caller-chosen key can name them.
export const bucketKey = (scope: LimiterScope, subject: string) => `rate:${scope}:${subject}`;
export const userBucketKey = (userId: string) => `rate:user:${userId}`;
export const ceilingKey = (address: string) => `rate:ceiling:${address}`;
export const activeUsersKey = (address: string, slot: number) => `rate:users:${address}:${slot}`;
export const missesKey = (address: string) => `rate:misses:${address}`;
export const divisorKey = (address: string) => `rate:shrink:${address}`;
/**
 * The AI firewall's decided division of the same ceiling (phase 55 01.6, `limiter.throttle`), kept apart from the misbehaviour script's
 * `divisorKey`: the signed-in script divides by the larger of the two, so neither writer can shorten, weaken or lift the other's division.
 */
export const firewallDivisorKey = (address: string) => `rate:fwshrink:${address}`;
/**
 * The run that set the firewall's division (phase 55 01.6, D55-20): its proposal id, written with the divisor in one MULTI and with the
 * same span. The divisor key stays a bare number for the scripts' `divisor()`; the undo lifts the division only while this still names
 * its run (`CLEAR_FIREWALL_DIVISOR_SCRIPT`), so a late undo of one run never ends a later run's division of the same strength.
 */
export const firewallDivisorRunKey = (address: string) => `rate:fwshrink-by:${address}`;
export const shrunkKey = (address: string) => `rate:shrunk:${address}`;
export const revokedSessionKey = (sessionId: string) => `rate:revoked:${sessionId}`;

// limiter.03: the bound of every limiter round trip (limiter.redis-bound.ts, where the proxy's ban gate reads it without this file's imports).
export { LIMITER_REDIS_TIMEOUT_MS, withinRedisBound };

/**
 * Runs one of the limiter's scripts: EVALSHA, and EVAL when the server does not have it cached yet (NOSCRIPT), within the Redis bound.
 * limiter.07: a reply that is not the script's `size` whole numbers (a null from a failover proxy, an aborted call) is a Redis failure
 * and follows the caller's fail mode, never a verdict of "admit".
 */
export async function runLimiterScript(script: LimiterScript, keys: string[], args: Array<string | number>, size: number): Promise<number[]> {
  const call = async (): Promise<unknown> => {
    try {
      return await redis.evalsha(script.sha, keys.length, ...keys, ...args);
    } catch (err) {
      if (!/NOSCRIPT/.test(err instanceof Error ? err.message : String(err))) throw err;
      return redis.eval(script.lua, keys.length, ...keys, ...args);
    }
  };
  const reply = await withinRedisBound(call());
  if (!Array.isArray(reply) || reply.length !== size || !reply.every((v) => Number.isSafeInteger(v))) {
    throw new Error('rate-limit script returned no verdict');
  }
  return reply as number[];
}

/** limiter.06: the metric is telemetry; a failing metrics backend never decides whether a request is admitted. */
function recordHit(scope: string, tenantId: string | null): void {
  try {
    ObservabilityService.recordRateLimitHit(scope as never, tenantId);
  } catch (err) {
    Logger.warn(`[limiter] rate-limit-hit metric failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** How the limiter behaves when Redis is unavailable. */
export type FailMode = 'open' | 'closed';

export interface RateLimitCheck {
  success: boolean;
  remaining: number;
  /** The per-minute rate of the bucket that decided (after an address's divisor). */
  limit: number;
  /** Seconds the caller should wait before retrying — for the `Retry-After` header. */
  retryAfter: number;
  /** Unix epoch (seconds) when the bucket is full again. */
  resetAt: number;
  /** A signed-in check that refused: which bucket did. */
  refusedBy?: 'user' | 'address';
}

const positive = (n: number | undefined): number | undefined => (n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : undefined);

const nowSeconds = (now = Date.now()) => Math.floor(now / 1000);

/** What an admission or a refusal tells the caller, from a script's numbers. */
function verdict(admitted: boolean, remaining: number, limit: number, waitMs: number, fullInMs: number, now: number): RateLimitCheck {
  return {
    success: admitted,
    remaining: admitted ? Math.max(remaining, 0) : 0,
    limit,
    retryAfter: admitted ? 0 : Math.max(1, Math.ceil(waitMs / 1000)),
    resetAt: nowSeconds(now) + Math.ceil(fullInMs / 1000),
  };
}

/** The answer of a limiter that does not count (RATE_LIMIT_DISABLED, or a fail-open Redis error). */
const unlimited = (limit: number): RateLimitCheck => ({ success: true, remaining: limit, limit, retryAfter: 0, resetAt: nowSeconds() + RATE_LIMIT_WINDOW });

/**
 * One token bucket (GCRA, one atomic script; limiter.gcra.ts) for a subject in a scope: `LIMITS[scope]` a minute, all of it at once
 * when the bucket is full. Emits a `Retry-After` value, a Prometheus rate-limit-hit metric, and honours a fail-open/fail-closed policy
 * for Redis outages (default: fail open for `api` and `i18n`, so a cache blip never locks out real traffic; fail closed for `auth`, the
 * credential surface, and `csp`; pass `failMode` to choose).
 * `limit` replaces the scope's rate for a caller with its own budget under its own key (e.g. the fleet heartbeat lane, 12 per node and
 * client per minute) and `burst` the bucket's size (default: the rate, one minute's worth); a value that is not a positive integer is
 * ignored.
 */
export async function check(
  ip: string,
  scope: LimiterScope = 'api',
  opts?: { failMode?: FailMode; tenantId?: string | null; limit?: number; burst?: number },
): Promise<RateLimitCheck> {
  const limit = positive(opts?.limit) ?? LIMITS[scope];
  const burst = positive(opts?.burst) ?? limit;
  // limiter.01 / limiter.07: the auth scope (login, OTP, captcha, reset) defaults to fail CLOSED: brute-force protection must
  // not vanish with Redis (an error, a timeout or a reply that is not a verdict). The api scope stays open by design.
  const failMode = opts?.failMode ?? (FAIL_CLOSED_SCOPES.has(scope) ? 'closed' : 'open');

  if (env.RATE_LIMIT_DISABLED) return unlimited(limit);

  const now = Date.now();
  try {
    const [admitted, remaining, waitMs, fullInMs, perMinute] = await runLimiterScript(BUCKET_SCRIPT, [bucketKey(scope, ip)], [REDIS_CLOCK, limit, burst], 5);
    const result = verdict(admitted === 1, remaining!, perMinute!, waitMs!, fullInMs!, now);
    if (!result.success) {
      Logger.warn(`[limiter] rate-limit hit: scope=${scope} ip=${ip}`);
      recordHit(scope, opts?.tenantId ?? null);
    }
    return result;
  } catch (err) {
    Logger.warn(`[limiter] Redis error (fail-${failMode}): ${err instanceof Error ? err.message : String(err)}`);
    if (failMode === 'closed') {
      recordHit(scope, opts?.tenantId ?? null);
      return { success: false, remaining: 0, limit, retryAfter: RATE_LIMIT_WINDOW, resetAt: nowSeconds(now) + RATE_LIMIT_WINDOW };
    }
    return unlimited(limit);
  }
}

/**
 * The read-only twin of `BUCKET_SCRIPT` for `peek` (41-ui-fixes/14 2.1): the same GCRA step on the Redis server's clock, but nothing is
 * written, so reading a bucket never spends it. KEYS[1] the bucket. ARGV: now (REDIS_CLOCK, or pinned ms), the per-minute rate, the burst.
 * Returns { would admit (1 or 0), requests admissible right now, wait ms, ms until full, the per-minute rate applied }.
 */
const PEEK_LUA = `
local pinned = tonumber(ARGV[1])
local now
if pinned ~= nil then now = pinned * 1000 else
  local t = redis.call('TIME')
  now = tonumber(t[1]) * 1000000 + tonumber(t[2])
end
local per_minute = tonumber(ARGV[2])
local emission = math.ceil(60000000 / per_minute)
local burst = tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', KEYS[1]))
if tat == nil or tat ~= tat or tat < now then tat = now end
local allow_at = tat + emission - emission * burst
local full = math.ceil((tat - now) / 1000)
if now < allow_at then return { 0, 0, math.ceil((allow_at - now) / 1000), full, per_minute } end
return { 1, math.floor((now - allow_at) / emission) + 1, 0, full, per_minute }
`;
export const PEEK_SCRIPT: LimiterScript = { lua: PEEK_LUA, sha: createHash('sha1').update(PEEK_LUA).digest('hex') };

/**
 * The same bucket as `check`, READ without spending a token: `success` while a request would be admitted now.
 *
 * For a budget that counts only what succeeded (events' public registration per event, 41-ui-fixes/14 2.1): `peek`
 * before the work refuses a spent budget, `check` after a success spends one token, so refused attempts never use it up.
 * Two requests passing the peek together can each spend one: the budget may be overrun by the requests in flight, which
 * is what reading before writing costs. Same `limit`, `burst` and `failMode` rules as `check`.
 */
export async function peek(
  ip: string,
  scope: LimiterScope = 'api',
  opts?: { failMode?: FailMode; limit?: number; burst?: number },
): Promise<RateLimitCheck> {
  const limit = positive(opts?.limit) ?? LIMITS[scope];
  const burst = positive(opts?.burst) ?? limit;
  const failMode = opts?.failMode ?? (FAIL_CLOSED_SCOPES.has(scope) ? 'closed' : 'open');

  if (env.RATE_LIMIT_DISABLED) return unlimited(limit);

  const now = Date.now();
  try {
    const [admissible, remaining, waitMs, fullInMs, perMinute] = await runLimiterScript(PEEK_SCRIPT, [bucketKey(scope, ip)], [REDIS_CLOCK, limit, burst], 5);
    return verdict(admissible === 1, remaining!, perMinute!, waitMs!, fullInMs!, now);
  } catch (err) {
    Logger.warn(`[limiter] Redis error on peek (fail-${failMode}): ${err instanceof Error ? err.message : String(err)}`);
    if (failMode === 'closed') return { success: false, remaining: 0, limit, retryAfter: RATE_LIMIT_WINDOW, resetAt: nowSeconds(now) + RATE_LIMIT_WINDOW };
    return unlimited(limit);
  }
}

/** A signed-in person as their verified access token names them: the user, and the session the token belongs to. */
export interface SignedIn {
  userId: string;
  sessionId: string;
}

/**
 * A signed-in `api` request (D40-10(b), (c)): the user's bucket (`USER_API_LIMIT`, wherever they come from) and the ceiling of the
 * address it comes from (`ADDRESS_CEILING`, grown by the users active there, under the address's divisor), in one script that spends
 * both or neither. `person` comes from a verified token signature (limiter.service.next.ts), `address` is the client's rate-limit
 * bucket. A session revoked before its token expires (limiter.session-revoked.ts) is no person: its request spends the address's own
 * `api` bucket, as an anonymous one does, so a stolen token cannot keep draining its owner's bucket. Fails open, like every `api` check.
 */
export async function checkSignedIn(person: SignedIn, address: string, opts?: { tenantId?: string | null }): Promise<RateLimitCheck> {
  if (env.RATE_LIMIT_DISABLED) return unlimited(USER_API_LIMIT.perMinute);

  const { userId, sessionId } = person;
  const now = Date.now();
  const slots = activeUserSlots(now);
  let reply: number[];
  try {
    reply = await runLimiterScript(
      SIGNED_IN_SCRIPT,
      [
        userBucketKey(userId), ceilingKey(address), activeUsersKey(address, slots.current), activeUsersKey(address, slots.previous),
        divisorKey(address), revokedSessionKey(sessionId), firewallDivisorKey(address),
      ],
      [REDIS_CLOCK, USER_API_LIMIT.perMinute, USER_API_LIMIT.burst, ADDRESS_CEILING.base, ADDRESS_CEILING.perUser, ADDRESS_CEILING.max, ADDRESS_CEILING.burstSeconds, userId, slots.ttlMs],
      8,
    );
  } catch (err) {
    Logger.warn(`[limiter] Redis error (fail-open): ${err instanceof Error ? err.message : String(err)}`);
    return unlimited(USER_API_LIMIT.perMinute);
  }
  const [admitted, refusedBy, remaining, waitMs, fullInMs, perMinute] = reply;
  if (refusedBy === 3) return check(address, 'api', { tenantId: opts?.tenantId ?? null });
  const result = verdict(admitted === 1, remaining!, perMinute!, waitMs!, fullInMs!, now);
  if (!result.success) {
    result.refusedBy = refusedBy === 1 ? 'user' : 'address';
    Logger.warn(`[limiter] rate-limit hit: scope=api ${result.refusedBy === 'user' ? `user=${userId}` : `ip=${address}`}`);
    recordHit(result.refusedBy === 'user' ? 'api_user' : 'api_address', opts?.tenantId ?? null);
  }
  return result;
}
