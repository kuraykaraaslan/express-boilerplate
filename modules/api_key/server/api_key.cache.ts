import type { QueryRunner } from 'typeorm';
import redis from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import { CACHE_VERSION_TTL_SECONDS, cacheDropOrders, type CacheDrop } from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { deliverRecorded, recordOrders } from '@kuraykaraaslan-labs/session_end/server/session_end.orders';
import type { RecordedSessionEndOrder } from '@kuraykaraaslan-labs/session_end/server/session_end.contract';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { API_KEY_SETTING_KEYS } from './api_key.setting.keys';
import type { ApiKey as ApiKeyEntity } from './entities/api_key.entity';

export const API_KEY_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60 * 5);
export const NEG = '__not_found__';

const CACHED_DATE_FIELDS = ['lastUsedAt', 'expiresAt', 'createdAt', 'updatedAt'] as const;

/**
 * A cached key row as the entity it was before `JSON.stringify`: the four date columns come back from JSON as strings and are revived
 * here, so the expiry check and the response schema see real dates. A date that does not parse, or a payload that is not an object, is
 * NOT trusted (an invalid `expiresAt` would compare as "never expires"): the caller drops the entry and re-reads the row. Takes the
 * JSON text or the already parsed value (the data of a sealed entry, D253).
 */
export function reviveCachedKey(json: unknown): ApiKeyEntity | null {
  let parsed: unknown = json;
  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  for (const field of CACHED_DATE_FIELDS) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    row[field] = date;
  }
  return row as unknown as ApiKeyEntity;
}

/**
 * The version of one key's verification entry (`api_key:hash:<hash>`, D253): the entry is believed only while it carries the version
 * read before the database read that filled it (session_end.cache-guard.ts). Every change that must end or narrow the key's access
 * bumps it in a cache-drop order recorded in the change's transaction, so a revoked key is refused by every node at once, also when
 * the drop reaches Redis late.
 */
export const apiKeyVersionKey = (keyHash: string): string => `api_key:ver:${keyHash}`;

type KeyRef = { apiKeyId: string; keyHash?: string | null; tenantId?: string };

/** The cache entries of a key and its version (what a drop deletes and bumps). */
export function keyDrop(apiKey: KeyRef): CacheDrop {
  const del = [`api_key:id:${apiKey.apiKeyId}`];
  const bump: string[] = [];
  if (apiKey.keyHash) {
    del.push(`api_key:hash:${apiKey.keyHash}`);
    bump.push(apiKeyVersionKey(apiKey.keyHash));
  }
  if (apiKey.tenantId) del.push(`api_key:tenant:${apiKey.tenantId}:${apiKey.apiKeyId}`);
  return { del, bump };
}

/**
 * Records the cache drops of `keys` in the change's open transaction on the shared database (`api_keys` is `@SharedDatabaseOnly`, as
 * `session_end_orders` is): the change commits with its drops or not at all. Throws when they cannot be recorded (the change rolls
 * back). Deliver the result after the commit with `deliverKeyDrops`.
 */
export function recordKeyDrops(qr: QueryRunner, tenantId: string, keys: readonly KeyRef[]): Promise<RecordedSessionEndOrder[]> {
  return recordOrders(cacheDropOrders(tenantId, 'api_key.cache_drop', keys.map((k) => keyDrop({ ...k, tenantId }))), { qr });
}

/** The fast path after the commit. Never throws: what Redis does not take now, the session_end relay delivers. */
export async function deliverKeyDrops(orders: readonly RecordedSessionEndOrder[]): Promise<void> {
  if (orders.length) await deliverRecorded(orders);
}

/**
 * Best-effort drop for a change that is not an access change (the expiry sweep: `verify` refuses an expired key from the row's own
 * `expiresAt` already). Deletes the entries and bumps the version; a failure is left to the entries' TTL.
 */
export async function clearCache(apiKey: { apiKeyId: string; keyHash?: string; tenantId?: string }) {
  const { del, bump } = keyDrop(apiKey);
  const ops: Promise<unknown>[] = del.map((k) => redis.del(k));
  for (const k of bump) ops.push(Promise.resolve().then(() => redis.incr(k)).then(() => redis.expire(k, CACHE_VERSION_TTL_SECONDS)));
  await Promise.all(ops.map((p) => p.catch(() => {})));
}

// In-memory cache for the platform-wide negative-cache TTL. Avoids a settings
// read on every verify; refreshed lazily once per minute.
let negTtlCache: { value: number; expiresAt: number } | null = null;

/**
 * Platform-wide negative-cache TTL, wired from the root tenant's
 * `apiKeyNegativeCacheTtlSeconds` setting (floored at 60s, never larger than
 * the positive cache TTL). Falls back to the previous hardcoded default when
 * the setting is unset or unreadable.
 */
export async function getNegativeCacheTtl(): Promise<number> {
  const fallback = Math.min(60, API_KEY_CACHE_TTL);
  const now = Date.now();
  if (negTtlCache && negTtlCache.expiresAt > now) return negTtlCache.value;
  let value = fallback;
  try {
    const raw = await SettingService.getValue(ROOT_TENANT_ID, API_KEY_SETTING_KEYS.NEGATIVE_CACHE_TTL_SECONDS);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed >= 60) value = Math.min(parsed, API_KEY_CACHE_TTL);
  } catch {
    /* keep fallback */
  }
  negTtlCache = { value, expiresAt: now + 60_000 };
  return value;
}
