import { randomUUID } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

/**
 * Who a storefront surface belongs to when the shopper may not be signed in.
 *
 * A signed-in shopper is their userId. An anonymous one is an opaque guest
 * token in a first-party httpOnly cookie: sent automatically with same-origin
 * fetches, and never read by client code.
 *
 * Shared since 2026-09-25 by the cart (`sf_cart`) and the wishlist (`sf_wish`),
 * the second consumer AGENTS.md §10.1 asks for before a thing becomes shared.
 * Each surface keeps its own cookie. A guest's cart and a guest's saved items
 * are different things with different lifetimes, and one token for both would
 * make clearing one clear the other.
 *
 * The cookie is read FIRST and unconditionally. When a signed-in shopper still
 * carries a guest cookie, the result asks the caller to merge that guest's data
 * into the user's (`mergeGuestToken`) and to clear the cookie afterwards. An
 * early return on userId would orphan whatever the shopper built as a guest.
 */

export interface GuestIdentity {
  userId?: string
  guestToken?: string
  /** A NEW guest token to write onto the response cookie. */
  setGuestToken?: string
  /** A user AND a guest cookie at once: the guest data to merge into the user's. */
  mergeGuestToken?: string
  /** After a successful merge the cookie goes (maxAge 0). */
  clearGuestToken?: boolean
  /** No identity at all (an anonymous read before anything was created). */
  anonymous: boolean
}

/** common.42: a guest token is a random (RFC 4122) UUID the server minted; anything else in the cookie is not an identity. */
const GUEST_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function resolveGuestIdentity(
  request: NextRequest, cookieName: string, userId: string | null | undefined, create: boolean,
): GuestIdentity {
  const raw = request.cookies.get(cookieName)?.value
  const existing = raw && GUEST_TOKEN_RE.test(raw) ? raw : undefined
  if (userId) {
    return existing
      ? { userId, mergeGuestToken: existing, clearGuestToken: true, anonymous: false }
      : { userId, anonymous: false }
  }
  if (existing) return { guestToken: existing, anonymous: false }
  if (!create) return { anonymous: true }
  const token = randomUUID()
  return { guestToken: token, setGuestToken: token, anonymous: false }
}

/**
 * common.43: the guest cookie bears a shopper's cart and saved items, so it is Secure everywhere but local development
 * (browsers treat localhost as a secure context anyway).
 */
const GUEST_COOKIE_SECURE = (): boolean => process.env.NODE_ENV !== 'development'

/** Write a newly minted guest token, or delete the cookie after a merge. */
export function applyGuestCookie(
  response: NextResponse, cookieName: string, maxAgeSeconds: number, identity: Pick<GuestIdentity, 'setGuestToken' | 'clearGuestToken'>,
): NextResponse {
  if (identity.clearGuestToken) {
    response.cookies.set(cookieName, '', { httpOnly: true, secure: GUEST_COOKIE_SECURE(), sameSite: 'lax', path: '/', maxAge: 0 })
    return response
  }
  if (identity.setGuestToken) {
    response.cookies.set(cookieName, identity.setGuestToken, { httpOnly: true, secure: GUEST_COOKIE_SECURE(), sameSite: 'lax', path: '/', maxAge: maxAgeSeconds })
  }
  return response
}
