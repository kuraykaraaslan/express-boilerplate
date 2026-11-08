import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Pseudonymous actor references for the sealed audit chain.
 *
 *   actorRef = base64url( HMAC-SHA256( HKDF-SHA256(masterKey, info = 'ndek-audit:' + tenantId), actorId ) )
 *
 * Why a keyed reference and not a plain hash of the id: a user id is a guessable uuid, so a bare hash would let anyone
 * who holds the audit rows recompute the reference of a known person. Keyed with a per-tenant derived key, the
 * reference is only computable inside the node, it differs per tenant (no correlation across tenants), and the
 * mapping `audit_actor_identities` is the sole way back.
 *
 * The master key is SETTINGS_ENCRYPTION_KEY (64 hex = 32 bytes) until the real `ndek-audit` key hierarchy exists. The
 * HKDF info string already carries that key's future name, and every mapping row stores the `keyVersion` it was
 * derived with, so moving to the real key later is a version bump: references written with version 1 stay resolvable
 * (the reader looks a reference up, it never recomputes one).
 *
 * Pure: the key is a parameter. Reading it from the environment, and refusing to write when it is missing, is the
 * writer's job (audit_log.write.service.ts).
 */

/** Version of the derivation above. Stored on every mapping row. */
export const ACTOR_REF_KEY_VERSION = 1;

const MASTER_KEY_HEX = /^[0-9a-fA-F]{64}$/;
const MAX_CACHED_KEYS = 256;
const keyCache = new Map<string, Buffer>();

/** The per-tenant HMAC key. Cached per (master key, tenant) because HKDF runs on every audited request. */
function tenantKey(masterKeyHex: string, tenantId: string): Buffer {
  if (!MASTER_KEY_HEX.test(masterKeyHex)) {
    throw new Error('audit actorRef: the master key must be 64 hex characters (32 bytes)');
  }
  const tenant = tenantId.toLowerCase();
  const cacheKey = `${masterKeyHex}:${tenant}`;
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  const derived = Buffer.from(hkdfSync('sha256', Buffer.from(masterKeyHex, 'hex'), Buffer.alloc(0), `ndek-audit:${tenant}`, 32));
  if (keyCache.size >= MAX_CACHED_KEYS) keyCache.clear();
  keyCache.set(cacheKey, derived);
  return derived;
}

export interface DerivedActorRef {
  /** 43 base64url characters; fits the varchar(64) column. */
  actorRef: string;
  keyVersion: number;
}

/** The pseudonym of `actorId` inside `tenantId`. Deterministic: the same inputs always give the same reference. */
export function deriveActorRef(masterKeyHex: string, tenantId: string, actorId: string): DerivedActorRef {
  const actorRef = createHmac('sha256', tenantKey(masterKeyHex, tenantId)).update(actorId.toLowerCase()).digest('base64url');
  return { actorRef, keyVersion: ACTOR_REF_KEY_VERSION };
}
