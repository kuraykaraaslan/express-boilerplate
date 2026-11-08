import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The access token of a password-protected status page (observability phase 15.3), as pure functions.
 *
 * A visitor who gives the right password gets a signed, short-lived token in an HttpOnly cookie; the page API accepts the cookie and
 * nothing else (never a query parameter: a URL is copied, logged and sent in `Referer`). The token binds
 *
 *   - the page (a token for one page opens no other),
 *   - an expiry,
 *   - a fingerprint of the CURRENT password hash, so changing the password signs everyone out at once.
 *
 * The signing key is derived from a server secret, never stored, and compared in constant time.
 */

export const ACCESS_TTL_SECONDS = 12 * 60 * 60

const TOKEN_VERSION = 'v1'

/** The cookie that carries one page's token. Derived from the page id, so two password pages never overwrite each other. */
export function accessCookieName(pageId: string): string {
  return `sp_${pageId.replace(/-/g, '').slice(0, 16)}`
}

export function deriveAccessKey(secret: string): Buffer {
  return createHash('sha256').update(`status-page-access:${TOKEN_VERSION}:${secret}`).digest()
}

/** A short, non-reversible tag of the password hash the token was issued against. */
export function passwordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(`pw:${passwordHash}`).digest('hex').slice(0, 16)
}

function mac(key: Buffer, pageId: string, expiresAt: number, fingerprint: string): string {
  return createHmac('sha256', key).update(`${pageId}.${expiresAt}.${fingerprint}`).digest('base64url')
}

export function signAccessToken(args: { key: Buffer; pageId: string; passwordHash: string; nowMs: number; ttlSeconds?: number }): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(args.nowMs / 1000) + (args.ttlSeconds ?? ACCESS_TTL_SECONDS)
  const sig = mac(args.key, args.pageId, expiresAt, passwordFingerprint(args.passwordHash))
  return { token: `${TOKEN_VERSION}.${expiresAt}.${sig}`, expiresAt }
}

export function verifyAccessToken(args: { key: Buffer; pageId: string; passwordHash: string | null | undefined; token: string | null | undefined; nowMs: number }): boolean {
  if (!args.token || !args.passwordHash) return false
  const parts = args.token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return false
  const expiresAt = Number(parts[1])
  if (!Number.isInteger(expiresAt) || expiresAt * 1000 <= args.nowMs) return false
  const expected = Buffer.from(mac(args.key, args.pageId, expiresAt, passwordFingerprint(args.passwordHash)))
  const given = Buffer.from(parts[2])
  return expected.length === given.length && timingSafeEqual(expected, given)
}
