import { createHash, createHmac, hkdfSync } from 'node:crypto';
import { addressBucketOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.ip';

/**
 * The feature store's actor ids (docs/phases/55-ai-firewall/02 §2.1, §2.8): features are keyed by a KEYED hash of the id, never by the
 * raw user id, address, key id, e-mail address or user agent, and never by a bare unsalted hash (a user id is a guessable uuid and an
 * IPv4 address space is small: anyone holding the Redis keys could recompute a plain hash of a known person or address).
 *
 *   featureId = base64url( HMAC-SHA256( K, kind + ':' + lower(id) ) )[0..22)      (132 bits)
 *   K         = HKDF-SHA256( SETTINGS_ENCRYPTION_KEY, info = 'ai_firewall:feature-id:v1' )
 *
 * The key is derived with its own label from the installation's settings encryption key (the audit chain's actor references come from
 * the same master with another label), or, where that is not set, from ACCESS_TOKEN_SECRET. It never leaves the process. Stable per
 * installation, so a baseline written yesterday is found today; rotating the master key starts every baseline afresh (cold start, the
 * cascade then skips stage 1 for a while: 04.8). Without either secret no feature id can be made and the feature store stays off
 * (`featureIdKey()` null; the folds count it as dropped `no_key`).
 *
 * An address (`ip`) is keyed by the unit one client controls (D55-48, `addressBucketOf`): an IPv4 address as itself, an IPv6 address as
 * its /64, so a host rotating inside the /64 it was handed is one actor (one set of windows), not a new set of keys per request.
 *
 * Ids are cached per process (a request needs two, the address and the caller), bounded by entries AND by input length (D55-45): an
 * input longer than CACHE_INPUT_MAX characters (a user agent, an attacker-chosen e-mail) is hashed every time and never cached, so the
 * cache holds at most CACHE_MAX × CACHE_INPUT_MAX characters whatever a caller sends.
 */
export const FEATURE_ID_INFO = 'ai_firewall:feature-id:v1';
export const FEATURE_ID_LENGTH = 22;
const CACHE_MAX = 20_000;
export const CACHE_INPUT_MAX = 320;

let keyOverride: Buffer | null | undefined;
let cachedKey: { source: string; key: Buffer | null } | null = null;
/** Per key (a test's fixed key and the environment's never share entries), bounded. */
const caches = new WeakMap<Buffer, Map<string, string>>();

function masterSecret(): string | null {
  const settingsKey = process.env.SETTINGS_ENCRYPTION_KEY;
  if (typeof settingsKey === 'string' && settingsKey.trim()) return `s:${settingsKey.trim()}`;
  const access = process.env.ACCESS_TOKEN_SECRET;
  if (typeof access === 'string' && access.trim()) return `a:${access.trim()}`;
  return null;
}

/** The process's feature-id key, or null when the installation has no secret to derive it from. */
export function featureIdKey(): Buffer | null {
  if (keyOverride !== undefined) return keyOverride;
  const source = masterSecret();
  if (cachedKey && cachedKey.source === (source ?? '')) return cachedKey.key;
  // HKDF over a digest of the secret: the secret's own encoding (hex, base64, text) does not matter
  const key = source
    ? Buffer.from(hkdfSync('sha256', createHash('sha256').update(source).digest(), Buffer.alloc(0), FEATURE_ID_INFO, 32))
    : null;
  cachedKey = { source: source ?? '', key };
  return key;
}

/** The keyed id of an actor (or of an e-mail address, a subject, a device) of `kind`. Null without a key. Never throws. */
export function featureIdOf(kind: string, id: string, key: Buffer | null = featureIdKey()): string | null {
  if (!key || !id) return null;
  const value = kind === 'ip' && id.includes(':') ? addressBucketOf(id) : id;
  const input = `${kind}:${value.toLowerCase()}`;
  if (input.length > CACHE_INPUT_MAX) return createHmac('sha256', key).update(input).digest('base64url').slice(0, FEATURE_ID_LENGTH);
  let cache = caches.get(key);
  const hit = cache?.get(input);
  if (hit) return hit;
  const out = createHmac('sha256', key).update(input).digest('base64url').slice(0, FEATURE_ID_LENGTH);
  if (!cache) { cache = new Map(); caches.set(key, cache); }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(input, out);
  return out;
}

/** A short keyed tag (a route template, a device) for set members and profile fields: 12 characters. */
export function featureTagOf(kind: string, value: string, key: Buffer | null = featureIdKey()): string | null {
  return featureIdOf(kind, value, key)?.slice(0, 12) ?? null;
}

/** Test seam: a fixed key (a Buffer), no key (null), or back to the environment (undefined). */
export function setFeatureIdKey(key: Buffer | null | undefined): void {
  keyOverride = key;
  cachedKey = null;
}
