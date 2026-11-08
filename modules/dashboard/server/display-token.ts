import { createHash, randomBytes } from 'node:crypto'

/**
 * The display link token (owner decision 2026-10-17 #10; docs/phases/07-dashboard/20 items 20.2c and 20.2d).
 *
 * A display link lets a wall screen, a kiosk or a TV show ONE shared board without a session. The raw token is
 * shown once, to whoever created the link, and lives in the screen's URL FRAGMENT (`/display#<token>`, owner decision
 * 2026-10-18 #19): a fragment never reaches the server, a proxy, an access log or a `Referer`. Links minted before that
 * decision carry it in the path (`/display/<token>`), which keeps working until they expire. The database keeps only
 * its SHA-256, so a read of `dashboard_display_links` cannot open a screen.
 *
 * Every API call carries it in an `X-Display-Token` header, never in a URL or a cookie. `Authorization: Display <token>`
 * (the header before #19) is still read, so a screen that loaded the earlier page keeps working until it reloads. The
 * session parser only reads `Bearer`, so a display request is an anonymous one as far as the session layer is
 * concerned, and a cross-site page cannot set either header (no CORS). A request whose QUERY STRING carries a
 * token-shaped value is refused outright, header or not: a token in a URL is in every log it passes.
 *
 * Pure: no database, no env. The link service, the display principal and the tests share these definitions.
 */

export const DISPLAY_TOKEN_PREFIX = 'dsp_'
/** Long enough that guessing is not a strategy (quote.token.ts uses the same). */
export const TOKEN_BYTES = 32
/** `dsp_` + 32 bytes in base64url (43 characters, no padding). */
export const DISPLAY_TOKEN_RE = /^dsp_[A-Za-z0-9_-]{43}$/
/** The `Authorization` scheme of the header before decision #19, still read (see above). */
export const DISPLAY_AUTH_SCHEME = 'Display'
/** The header a screen sends its token in (decision #19). */
export const DISPLAY_TOKEN_HEADER = 'X-Display-Token'
/** A token-shaped value anywhere in a query string (`dsp_` + 43 base64url characters, raw or percent-encoded). */
const TOKEN_IN_QUERY_RE = /dsp_[A-Za-z0-9_-]{43}/

export const DEFAULT_TTL_DAYS = 30
export const MAX_TTL_DAYS = 365
/** Active (unexpired, unrevoked) links per board: a screen fleet, not a distribution list. */
export const MAX_ACTIVE_LINKS_PER_BOARD = 20
/** `lastUsedAt` is written at most once a minute per link: it answers "is this screen alive", not "how often". */
export const LAST_USED_GRANULARITY_SECONDS = 60
/** Requests a minute per link, counted on the token hash (several screens may share one link). */
export const DISPLAY_LINK_RATE_PER_MINUTE = 60

const DAY_MS = 24 * 60 * 60 * 1000

/** A fresh raw token. Returned once to the creator; never stored, never logged. */
export function generateDisplayToken(): string {
  return DISPLAY_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url')
}

/** What the database stores and looks a token up by: 64 lowercase hex characters. */
export function hashDisplayToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * The raw token of a display request, or null: the `X-Display-Token` header when it is present (and then only it, so
 * a malformed one is not rescued by the other header), otherwise an `Authorization: Display <token>` header. Any other
 * scheme or shape is null, and so is any request whose query string carries a token-shaped value (decision #19: the
 * token is never accepted from a URL, and a client that puts it there is refused rather than half-served).
 */
export function tokenFromRequest(request: { headers: { get(name: string): string | null }; url?: string }): string | null {
  if (request.url && tokenInQuery(request.url)) return null
  const own = request.headers.get(DISPLAY_TOKEN_HEADER)
  if (own !== null) {
    const v = own.trim()
    return DISPLAY_TOKEN_RE.test(v) ? v : null
  }
  const header = request.headers.get('authorization')
  if (!header) return null
  const m = /^(\S+)\s+(\S+)$/.exec(header.trim())
  if (!m || m[1] !== DISPLAY_AUTH_SCHEME) return null
  return DISPLAY_TOKEN_RE.test(m[2]) ? m[2] : null
}

/** Whether a URL's query string carries a token-shaped value (decoded once, so `%5F` does not hide one). */
function tokenInQuery(url: string): boolean {
  let search: string
  try {
    search = new URL(url, 'http://localhost').search
  } catch {
    return false
  }
  if (!search) return false
  let decoded = search
  try {
    decoded = decodeURIComponent(search)
  } catch {
    // a malformed escape: test the raw form
  }
  return TOKEN_IN_QUERY_RE.test(search) || TOKEN_IN_QUERY_RE.test(decoded)
}

/** The per-link rate-limit key: a prefix of the HASH, so the raw token never becomes a Redis key. */
export function limiterKey(hash: string): string {
  return 'dashboard-display:' + hash.slice(0, 32)
}

/** When a link created `now` with a lifetime of `days` expires. */
export function expiryFrom(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * DAY_MS)
}
