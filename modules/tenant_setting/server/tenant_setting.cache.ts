import redis from '@kuraykaraaslan-labs/redis';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { extensionStateChannel } from '@kuraykaraaslan-labs/common/server/extensions/extension-state.channel';

const REDIS_KEY_PREFIX = 'settings:';
// 38-security 5.4: the map holds decrypted credentials; a write invalidates it, so the TTL only bounds how long a MISSED invalidation (a Redis blip) can serve a stale or
// rotated secret. Short, not 10 minutes.
const REDIS_TTL = 120;

export function getCacheKey(tenantId: string, key?: string): string {
  return key
    ? `${REDIS_KEY_PREFIX}${tenantId}:${key}`
    : `${REDIS_KEY_PREFIX}${tenantId}:all`;
}

export async function getFromCache(cacheKey: string): Promise<string | null> {
  try { return await redis.get(cacheKey); } catch { return null; }
}

export async function setCache(cacheKey: string, value: string, ttl = REDIS_TTL): Promise<void> {
  try { await redis.set(cacheKey, value, 'EX', ttl); } catch {}
}

export async function deleteCache(...cacheKeys: string[]): Promise<void> {
  if (!cacheKeys.length) return;
  try { await redis.del(...cacheKeys); } catch {}
}

// ── Refill fence ──────────────────────────────────────────────────────────
// A per-tenant write counter, so a cold-cache read whose database query overlapped a write never leaves the pre-write
// map cached for the full TTL (a removed ipBlacklist entry kept refusing an office for 10 minutes; review 2026-10-18).
// The writer bumps the counter BEFORE it drops the map; the reader notes the counter before its query, fills the map,
// then drops what it filled if the counter moved. Either the reader sees the bump, or the bump (and so the writer's
// drop) comes after the reader's fill. Every redis failure degrades to the old unfenced fill.
function versionKey(tenantId: string): string {
  return `${REDIS_KEY_PREFIX}${tenantId}:ver`;
}

/** The tenant's write counter (null when redis cannot say). Pass it to `fillAllUnlessWritten` after the read. */
export async function readWriteVersion(tenantId: string): Promise<number | null> {
  try {
    const n = Number(await redis.incrby(versionKey(tenantId), 0));
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** Cache the tenant's full map, then drop it again if a write landed since `since` was read. */
export async function fillAllUnlessWritten(tenantId: string, value: string, since: number | null): Promise<void> {
  const key = getCacheKey(tenantId);
  await setCache(key, value);
  if (since === null) return;
  if ((await readWriteVersion(tenantId)) !== since) await deleteCache(key);
}

// ── Resolved enabled-module set (getEnabledModuleIds) ────────────────────
// One entry per tenant under its own `settings:<tenant>:` namespace, so
// clearCache removes it too. The value carries the registry hash (a deploy that
// changes the module list or the default rules never serves an old set). The
// set depends on this tenant's own rows only — `module.<id>.enabled` is never
// inherited from ROOT (see isLedgerProjectionKey) — so a write invalidates just
// the written tenant's entry.
const MODULES_ENABLED_TTL = 60;
const MODULE_ENABLED_KEY = /^module\..+\.enabled$/;

export function getModulesEnabledCacheKey(tenantId: string): string {
  return `${REDIS_KEY_PREFIX}${tenantId}:modules:enabled`;
}

/** `ids` is null on a miss. */
export async function readModulesEnabled(
  tenantId: string,
  registryHash: string,
): Promise<{ ids: string[] | null }> {
  const raw = await getFromCache(getModulesEnabledCacheKey(tenantId));
  if (!raw) return { ids: null };
  try {
    const v = JSON.parse(raw) as { h?: unknown; ids?: unknown };
    if (v.h === registryHash && Array.isArray(v.ids)) return { ids: v.ids as string[] };
  } catch {}
  return { ids: null };
}

export async function writeModulesEnabled(
  tenantId: string,
  registryHash: string,
  ids: string[],
): Promise<void> {
  await setCache(getModulesEnabledCacheKey(tenantId), JSON.stringify({ h: registryHash, ids }), MODULES_ENABLED_TTL);
}

// Drop what a write to `keys` invalidates in one DEL: the tenant's full map
// (the only thing reads use) plus the legacy per-key entries, which an older
// replica may still read during a rolling deploy. A `module.<id>.enabled` write
// also drops the tenant's resolved module set.
/** True when a write of `keys` changes the tenant's resolved module set (also the durable drop's rule, tenant_setting.cache-drop.ts). */
export function writeTouchesModules(keys: readonly string[]): boolean {
  // The platform ban list (ROOT) changes every tenant's enabled set, like ROOT's own module flags.
  return keys.some((k) => MODULE_ENABLED_KEY.test(k) || k === 'platform.module_bans');
}

export async function invalidateWrite(tenantId: string, keys: string[]): Promise<void> {
  const touchesModules = writeTouchesModules(keys);
  // Before the drop (see the refill fence above).
  try { await redis.incrby(versionKey(tenantId), 1); } catch {}
  await deleteCache(
    ...keys.map((k) => getCacheKey(tenantId, k)),
    getCacheKey(tenantId),
    ...(touchesModules ? [getModulesEnabledCacheKey(tenantId)] : []),
  );
  if (touchesModules) {
    // Open admin sessions reload their menus, slots and blocks (docs/phases/37-extensions/05). A ROOT write (the
    // platform's ban list) reaches every tenant. Best-effort: a lost announcement costs a session its live update,
    // never the write.
    const scope = isRootTenant(tenantId) ? '*' : tenantId;
    try { await redis.publish(extensionStateChannel(scope), JSON.stringify({ at: Date.now() })); } catch {}
  }
}

// ── Bulk cache invalidation via Redis pattern match ──────────────────────
export async function clearCache(tenantId: string): Promise<void> {
  const pattern = `${REDIS_KEY_PREFIX}${tenantId}:*`;
  let cursor = '0';
  do {
    try {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await redis.unlink(...keys).catch(() => {});
    } catch { break; }
  } while (cursor !== '0');
}
