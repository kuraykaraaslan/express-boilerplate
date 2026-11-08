import { randomUUID } from 'crypto';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import ObservabilityService from '@kuraykaraaslan-labs/observability';
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service';
import { withinRedisBound } from './limiter.service';

const WINDOW_MS = 60_000; // 1 minute

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  limit: number;
  /** Seconds to wait before retrying — for the `Retry-After` header. */
  retryAfter: number;
}

/**
 * Sliding-window rate limiter over an arbitrary Redis sorted-set key. A
 * `limitPerMinute` of `-1` means unlimited. Shared by the tenant-plan and
 * per-webhook limiters so they use one battle-tested algorithm.
 */
export async function checkSlidingWindowRateLimit(
  key: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  if (limitPerMinute === -1) {
    return { success: true, remaining: Number.POSITIVE_INFINITY, limit: -1, retryAfter: 0 };
  }

  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const member = `${now}:${randomUUID().replace(/-/g, '')}`;

  try {
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(key, '-inf', windowStart);
    pipe.zadd(key, now, member);
    pipe.zcard(key);
    pipe.expire(key, 61);
    pipe.zrange(key, 0, 0, 'WITHSCORES'); // oldest entry → retry-after
    const results = await withinRedisBound(pipe.exec());

    // limiter.07: an aborted or partial MULTI leaves the ZCARD reply missing; it used to read as 0 and admit an exhausted caller.
    // The count is then asked for on its own; only when that fails too does the window's fail-open policy apply.
    const reply = results?.[2];
    let count = !reply || reply[0] ? Number.NaN : Number(reply[1]);
    if (!Number.isInteger(count) || count < 0) {
      const added = !!results?.[1] && !results[1][0];
      // This request counts whether or not its ZADD landed.
      count = Number(await withinRedisBound(redis.zcard(key))) + (added ? 0 : 1);
    }
    if (!Number.isInteger(count) || count < 0) throw new Error('sliding-window count unavailable');
    const success = count <= limitPerMinute;
    // limiter.02: only an ADMITTED request occupies the window. A refused one takes its own entry back out, so a client that
    // keeps hammering while refused is served again as soon as its admitted requests age out (and the set stays <= limit + 1).
    if (!success) {
      try { await withinRedisBound(redis.zrem(key, member)); } catch { /* the entry ages out with the window */ }
    }

    // Retry-After: when the oldest in-window entry ages out, a slot frees up.
    let retryAfter = 0;
    if (!success) {
      const oldest = results?.[4]?.[1] as string[] | undefined;
      const oldestScore = oldest && oldest.length >= 2 ? Number(oldest[1]) : now;
      retryAfter = Math.max(1, Math.ceil((oldestScore + WINDOW_MS - now) / 1000));
      Logger.warn(`[limiter] sliding-window limit hit: key=${key} count=${count} limit=${limitPerMinute}`);
    }

    return {
      success,
      remaining: Math.max(limitPerMinute - count, 0),
      limit: limitPerMinute,
      retryAfter,
    };
  } catch (err) {
    Logger.warn(`[limiter] Redis pipeline error (fail-open): ${err instanceof Error ? err.message : String(err)}`);
    return { success: true, remaining: limitPerMinute, limit: limitPerMinute, retryAfter: 0 };
  }
}

/**
 * Per-tenant plan rate limit.
 *
 * `limitPerMinute` is passed IN — this module deliberately does not resolve it.
 * That is DEP-12's concern already satisfied: `limiter` is fabric, called from
 * every plane, and a fabric module that reads subscription plans would drag the
 * billing rail into everything. (The manifest carried a stale
 * `optional: tenant_subscription` claiming otherwise; removed 2026-08, along
 * with the missing `tenant_usage` declaration for the counter below.)
 *
 * **Wired since 2026-09-03** (DEP-12's live defect). It had no callers at all,
 * so the `api_rate_limit` plan feature gated nothing — the same shape as the
 * notification toggles before PLAT-01, and marked `[x]` in a checklist. The
 * recorded blocker was "every route must pass its tenantId, hundreds of call
 * sites"; that turned out to be false. The tenant is already in the URL every
 * route handler receives (`/tenant/{id}/api/…`), which `redis_idempotency`
 * has been reading for exactly this reason, so `Limiter.checkRateLimit` resolves
 * it itself and not one call site changed.
 */
export async function checkTenantPlanRateLimit(
  tenantId: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  // Track every checked call toward the monthly usage counter (best-effort, non-blocking).
  TenantUsageService.incrementApiCall(tenantId).catch(() => {});
  // D9: one window per tenant, whatever the spelling of its uuid in the URL.
  const result = await checkSlidingWindowRateLimit(`tenant:${tenantId.toLowerCase()}:ratelimit`, limitPerMinute);
  if (!result.success) {
    // limiter.06: telemetry never decides admission.
    try { ObservabilityService.recordRateLimitHit('tenant_plan', tenantId); } catch { /* metrics backend down */ }
  }
  return result;
}

/**
 * The tenant's per-minute API allowance from its plan, or `null` for "no limit
 * applies".
 *
 * `null` covers four different situations on purpose, because they all mean the
 * same thing to a caller: no plan declares the feature, the plan grants it
 * unlimited, the tenant has no subscription, or the gate could not be reached.
 * The last one is the interesting one — **this fails OPEN**. A rate limiter that
 * starts refusing every request because a feature-gate lookup broke is an outage
 * it manufactured itself, and the IP limit below is still standing in the
 * meantime.
 *
 * `feature_gate` is imported dynamically and is a genuine leaf (`logger` +
 * `redis` only), so `limiter` — which every plane calls — grows its dependency
 * closure by one node that was already inside it. The old objection ("a fabric
 * module that reads subscription plans drags the billing rail into everything")
 * stopped being true when DUP-01 step 5 made the gate a leaf; the plan rail is
 * not on this path at all.
 */
export async function resolveTenantApiLimit(tenantId: string): Promise<number | null> {
  try {
    const [{ default: FeatureGateService }, { FEATURE_KEYS }] = await Promise.all([
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.service'),
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'),
    ]);
    // `audit: false`: this probe runs on every tenant API request and only reads
    // the allowance, so auditing it wrote one `feature.access.checked` row per
    // call (mostly "no plan declares it"). The outcome that matters, a breached
    // limit, is still counted in Prometheus and logged by checkTenantPlanRateLimit.
    const result = await FeatureGateService.checkFeatureAccess(
      tenantId, FEATURE_KEYS.API_RATE_LIMIT, undefined, { audit: false },
    );
    if (result.type !== 'LIMIT' || result.unlimited) return null;
    // A plan may legitimately store anything; a zero or negative allowance would
    // mean "this tenant may make no API calls at all", which no plan intends and
    // which would take a paying customer off the air over a typo.
    return result.limit > 0 ? result.limit : null;
  } catch {
    return null;
  }
}

/** Per-endpoint webhook delivery rate limit (deliveries/minute). */
export async function checkWebhookRateLimit(
  webhookId: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  return checkSlidingWindowRateLimit(`webhook:${webhookId}:ratelimit`, limitPerMinute);
}
