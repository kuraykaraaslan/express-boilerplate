/**
 * Cache primitives — orthogonal helpers for the per-service cache code in `modules/*`.
 *
 * - `jitter(ttl)` spreads TTL by ±10% so a wave of keys written together don't all expire on the
 *   same second and trigger a thundering-herd refill.
 * - `singleFlight(key, loader)` dedupes concurrent in-process callers loading the same key.
 * - `singleFlightDistributed(key, loader, ttl)` extends single-flight across pods using a Redis
 *   SET NX lock so only one pod runs the loader at a time (thundering-herd protection at scale).
 * - `tenantKey(tenantId, ...segments)` builds a namespaced Redis key so every tenant's data is
 *   isolated and can be bulk-flushed with `clearTenantCache(tenantId)`.
 * - `clearTenantCache(tenantId)` evicts every Redis key that contains the tenant id (SCAN + UNLINK), and rejects when it could not.
 */

import redis from './redis.service';

const inflight = new Map<string, Promise<unknown>>();

export function jitter(ttlSeconds: number, factor = 0.1): number {
  const delta = (Math.random() * 2 - 1) * factor;
  return Math.max(1, Math.round(ttlSeconds * (1 + delta)));
}

export async function singleFlight<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      return await loader();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p as Promise<unknown>);
  return p;
}

/**
 * Cross-pod single-flight via Redis SET NX lock.
 * Only one pod runs `loader`; others wait and then read the result from Redis.
 * Falls back to running the loader directly if Redis is unavailable (fail-open).
 */
export async function singleFlightDistributed<T>(
  key: string,
  loader: () => Promise<T>,
  ttlSeconds: number,
  lockTtlSeconds = 10,
): Promise<T> {
  const lockKey = `lock:sf:${key}`;
  const cacheKey = `sf:${key}`;

  // 1. Check if a cached result already exists (winner already ran).
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as T;
  } catch {
    return loader(); // fail-open
  }

  // 2. Try to acquire the lock (SET NX EX).
  let acquired = false;
  try {
    const ok = await redis.set(lockKey, '1', 'EX', lockTtlSeconds, 'NX');
    acquired = ok === 'OK';
  } catch {
    return loader(); // fail-open
  }

  if (acquired) {
    // Winner: run the loader and store the result.
    try {
      const result = await loader();
      await redis.set(cacheKey, JSON.stringify(result), 'EX', ttlSeconds).catch(() => {});
      return result;
    } finally {
      await redis.del(lockKey).catch(() => {});
    }
  } else {
    // Loser: poll until the winner stores the result or the lock expires.
    const deadline = Date.now() + lockTtlSeconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as T;
      } catch {
        break;
      }
    }
    // If we timed out waiting, run the loader ourselves (fail-open).
    return loader();
  }
}

// ── Tenant key namespacing ───────────────────────────────────────────────────

/**
 * Build a namespaced Redis key for a tenant.
 * Pattern: `tenant:<tenantId>:<segment1>:<segment2>...`
 * All keys using this utility can be bulk-flushed with `clearTenantCache`.
 */
export function tenantKey(tenantId: string, ...segments: string[]): string {
  return `tenant:${tenantId}:${segments.join(':')}`;
}

const TENANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A SCAN glob matching any key that contains `uuid` in either letter case: built here from a validated id, never from raw input. */
function containsIdGlob(uuid: string): string {
  return `*${[...uuid.toLowerCase()].map((c) => (c >= 'a' && c <= 'f' ? `[${c}${c.toUpperCase()}]` : c)).join('')}*`;
}

/**
 * Evict every Redis key that names a tenant, for its purge (docs/phases/02-fleet/05 section 8, the GDPR erasure path at the cache layer).
 *
 *  - Every key CONTAINING the tenant id goes, not only the `tenant:<id>:*` namespace: the profile, routing and owner caches, the membership cache
 *    (`tenant:member:<user>:<id>`), sessions, geo and auth-failure counters, `settings:<id>:*` and whatever else spells the id (register D10). A tenant id
 *    is a UUID, so a key that contains it is about that tenant; the match ignores letter case (an id once spelled in capitals is found too).
 *  - The id must BE a UUID: the glob is built from it, and an id carrying `*`, `?` or `[` would otherwise sweep other tenants' keys (register redis.02).
 *  - A flush that could not finish REJECTS (register redis.03): the erasure must not look done while the data is still there. A failed batch does not
 *    stop the rest; the error comes at the end. Resolves with the number of keys removed.
 */
export async function clearTenantCache(tenantId: string): Promise<number> {
  if (!TENANT_ID_RE.test(tenantId)) throw new Error('clearTenantCache: the tenant id must be a UUID');
  const pattern = containsIdGlob(tenantId);
  let removed = 0;
  let failed: unknown = null;
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) {
      try { removed += Number(await redis.unlink(...keys)) || 0; } catch (err) { failed = err; }
    }
  } while (cursor !== '0');
  if (failed) throw new Error(`clearTenantCache: some keys of the tenant could not be removed (${failed instanceof Error ? failed.message : String(failed)})`);
  return removed;
}

// ── Graceful fail-open wrapper ───────────────────────────────────────────────

/**
 * Execute a Redis operation with graceful fail-open.
 * When Redis is unavailable the `fallback` value is returned instead of throwing.
 * Use this for non-critical cache reads where serving stale/no data is acceptable.
 */
export async function failOpen<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}
