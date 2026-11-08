import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@kuraykaraaslan-labs/env'
import { platformHost } from '@kuraykaraaslan-labs/common/server/tenant-url'
import { platformTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-path'

/**
 * The signed app URLs of local-disk objects. The disk has no signing surface of its own, so the app is the one that serves
 * an object (`storage-local-object.route.ts`) and the URL carries its own credential:
 *
 *   <host>/tenant/<tenantId>/api/storage/local/object?key=<tenantId/folder/file>&exp=<unix s>&sig=<base64url>
 *
 * `sig` is HMAC-SHA256 over `v1|<tenantId>|<key>|<exp>`, the key derived from ACCESS_TOKEN_SECRET for this use only, compared in
 * constant time. A URL is bound to the tenant of its path and to one key; it cannot be edited into another object or tenant.
 *
 * Two lifetimes (decided 2026-10-30, D120):
 *  - a presigned URL (`getReadUrl`, what `getPresignedUrl` answers) expires, 15 minutes by default as for the bucket providers;
 *  - a `getFileUrl` URL, the one an upload result carries and a column may store, lasts 7 days. Objects under `branding/`, `avatars/` and
 *    `headers/` are public by nature (logos and wallpapers show on the sign-in page before anyone signs in; avatars and headers are
 *    images every viewer of a profile sees, and a column stores their URL); their URL has `exp=0`, never expires, and is the ONLY kind of key the verifier accepts with `exp=0`.
 */

export const FILE_URL_TTL_SECONDS = 7 * 24 * 3600
/** Longest lifetime a signed URL may be asked for (a caller's `expiresSeconds` is clamped to it). */
export const MAX_SIGNED_TTL_SECONDS = 7 * 24 * 3600

// The label keeps the name of the module this code came from (storage_local, merged into storage 2026-11-03): changing it would
// invalidate every signed URL already stored, the permanent ones of avatars and branding included.
const LABEL = 'storage_local:url:v1'
const SIG_RE = /^[A-Za-z0-9_-]{43}$/

/** Folders (first path segment under the tenant) whose objects are public by nature: logos and wallpapers show before sign-in, avatars and headers show to everyone who sees the profile. */
const PUBLIC_FOLDER_ROOTS: ReadonlySet<string> = new Set(['branding', 'avatars', 'headers'])

/** Keys whose objects are public by nature: their signature never expires, so a URL a row stores (an avatar) does not go dead. */
export function isPublicKey(key: string): boolean {
  return PUBLIC_FOLDER_ROOTS.has(key.split('/')[1] ?? '')
}

function signingKey(): Buffer {
  const secret = env.ACCESS_TOKEN_SECRET
  if (!secret) throw new Error('ACCESS_TOKEN_SECRET is not configured')
  return createHmac('sha256', secret).update(LABEL).digest()
}

function mac(tenantId: string, key: string, exp: number): Buffer {
  return createHmac('sha256', signingKey()).update(`v1|${tenantId}|${key}|${exp}`).digest()
}

/** The tenant a key belongs to: its first segment. */
export const tenantOfKey = (key: string): string => key.split('/')[0] ?? ''

/** Path of the serving route, relative to the tenant (`/api/storage/local/object`). */
export const LOCAL_OBJECT_ROUTE = '/api/storage/local/object'

/** A signed URL for `key`. `ttlSeconds` 0 means no expiry and is only honoured for a public key (see PUBLIC_FOLDER_ROOTS). */
export function signLocalUrl(key: string, ttlSeconds: number, nowMs: number = Date.now()): string {
  const tenantId = tenantOfKey(key)
  const permanent = ttlSeconds === 0 && isPublicKey(key)
  const ttl = Math.min(Math.max(Math.floor(ttlSeconds) || 0, 1), MAX_SIGNED_TTL_SECONDS)
  const exp = permanent ? 0 : Math.floor(nowMs / 1000) + ttl
  const sig = mac(tenantId, key, exp).toString('base64url')
  const q = new URLSearchParams({ key, exp: String(exp), sig })
  return `${platformTenantUrl(platformHost(), tenantId, LOCAL_OBJECT_ROUTE)}?${q.toString()}`
}

export type SignatureVerdict = 'ok' | 'malformed' | 'expired' | 'bad_signature'

/** Check a request's `key`, `exp` and `sig` against the tenant of its path. Constant-time on the signature; no disk, no database. */
export function verifyLocalSignature(
  tenantId: string,
  input: { key: string | null; exp: string | null; sig: string | null },
  nowMs: number = Date.now(),
): SignatureVerdict {
  const { key, exp, sig } = input
  if (!key || !exp || !sig || key.length > 1024 || !/^\d{1,12}$/.test(exp) || !SIG_RE.test(sig)) return 'malformed'
  const expSec = Number(exp)
  const expected = mac(tenantId, key, expSec)
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return 'bad_signature'
  // Checked after the signature so an unsigned probe learns nothing about expiry.
  if (expSec === 0) return isPublicKey(key) ? 'ok' : 'bad_signature'
  return expSec * 1000 > nowMs ? 'ok' : 'expired'
}
