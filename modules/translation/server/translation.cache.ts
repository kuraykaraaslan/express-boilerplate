import redis, { jitter } from '@kuraykaraaslan-labs/redis';
import type { TranslationPlatform, TranslationScope } from './translation.types';

// Same shape as tenant_setting.cache: every Redis failure degrades to a miss (the
// caller reads the database) and a failed write or delete is swallowed.
//
// No tenant segment: the texts are system-wide by design (no tenant column), so every
// tenant reads the same entries.

const REDIS_TTL = 600;

/** module → version, for one locale and scope. */
export function versionsKey(locale: string, scope: TranslationScope): string {
  return `i18n:ver:${locale}:${scope}`;
}

/** One module's bundle for one locale and platform. */
export function messagesKey(locale: string, module: string, platform: TranslationPlatform): string {
  return `i18n:msg:${locale}:${module}:${platform}`;
}

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

/** One MGET; each entry is the value or null (a miss, unreadable, or Redis down). */
export async function readCacheMany<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  try {
    const raws = await redis.mget(...keys);
    return raws.map((raw) => {
      if (raw === null) return null;
      try { return JSON.parse(raw) as T; } catch { return null; }
    });
  } catch {
    return keys.map(() => null);
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try { await redis.set(key, JSON.stringify(value), 'EX', jitter(REDIS_TTL)); } catch {}
}

export async function deleteCache(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try { await redis.del(...keys); } catch {}
}
