import Logger from '@kuraykaraaslan-labs/logger'
import { checkChatUrl, redactSecrets, type ChatKind } from './chat.destination'
import { TEAMS_MAX_BYTES } from './chat.format'

/**
 * The one way a message leaves for a Slack or Teams incoming webhook (observability phase 14.7 and 15.5).
 *
 * Why not the `webhook` module's delivery machinery: it delivers `{ event, data }` envelopes to an endpoint row whose `url` is a plain column
 * and signs them with a key the receiver is meant to verify. A Slack or Teams URL is itself the credential (neither vendor verifies a
 * signature on an incoming webhook), the body must be the vendor's own document, and the URL must be stored encrypted. So this is a small
 * dedicated sender that keeps the parts of the webhook module that matter: the shared SSRF-pinned `safeFetch` (the connection is made to
 * the address that was validated, private ranges refused), no redirect followed, a short timeout, and retry with backoff.
 *
 * Nothing here ever logs, throws or returns the URL. An outcome carries a short code from a closed vocabulary, never a response body.
 */

export type ChatSendOutcome =
  | { status: 'sent' }
  /** Worth another attempt (429, 5xx, timeout, network). */
  | { status: 'retry'; code: string; retryAfterMs?: number }
  /** Not worth another attempt. `gone` = the destination was revoked or deleted at the vendor (403, 404, 410): switch it off. */
  | { status: 'failed'; code: string; gone?: boolean }

const TIMEOUT_MS = 5000
export const CHAT_MAX_ATTEMPTS = 3
const BACKOFF_MS = [1000, 4000]
const MAX_RETRY_AFTER_MS = 10_000

/**
 * Test seam. A unit or live test may widen egress to a loopback server it started itself (`egress.ipAllowlist`) and skip the vendor host and
 * https checks, which would otherwise (rightly) refuse it. Never set by configuration or environment; the setter refuses in production.
 */
export interface ChatSendSeam {
  /** Passed to safeFetch in the `operator` mode: since F.common.02 a default-mode list only narrows and never opens a private (loopback) address. */
  egress?: { ipAllowlist?: string[] | null }
  allowAnyHost?: boolean
  sleep?: (ms: number) => Promise<void>
  fetch?: typeof import('@kuraykaraaslan-labs/common/server/safe-fetch').safeFetch
}
let seam: ChatSendSeam | null = null
export function setChatSendSeamForTests(next: ChatSendSeam | null): void {
  if (next && process.env.NODE_ENV === 'production') throw new Error('the chat send seam is for tests only')
  seam = next
}

const wait = (ms: number) => (seam?.sleep ?? ((n: number) => new Promise<void>((r) => setTimeout(r, n))))(ms)

/** One attempt. Never throws. */
export async function postChatOnce(kind: ChatKind, url: string, payload: Record<string, unknown>): Promise<ChatSendOutcome> {
  if (!seam?.allowAnyHost) {
    const check = checkChatUrl(kind, url)
    if (!check.ok) return { status: 'failed', code: `refused_${check.reason}` }
  }
  let body: string
  try { body = JSON.stringify(payload) } catch { return { status: 'failed', code: 'unserialisable' } }
  if (kind === 'TEAMS' && Buffer.byteLength(body) > TEAMS_MAX_BYTES) return { status: 'failed', code: 'too_large' }
  try {
    const doFetch = seam?.fetch ?? (await import('@kuraykaraaslan-labs/common/server/safe-fetch')).safeFetch
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'NextBoilerplate-Observability/1.0' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }, seam?.egress ? { ...seam.egress, ipAllowlistMode: 'operator' } : {})
    // Drain a little so the socket is released; the text itself is never kept (a vendor error body can echo the request).
    await res.text().then((t) => t.length, () => 0)
    if (res.status >= 200 && res.status < 300) return { status: 'sent' }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      return { status: 'retry', code: 'rate_limited', ...(Number.isFinite(ra) && ra > 0 ? { retryAfterMs: Math.min(ra * 1000, MAX_RETRY_AFTER_MS) } : {}) }
    }
    if (res.status === 408 || res.status >= 500) return { status: 'retry', code: `http_${res.status}` }
    // A redirect is never followed (it could lead to an internal address) and is not an outcome that retrying changes.
    if (res.status >= 300 && res.status < 400) return { status: 'failed', code: 'redirect_refused' }
    return { status: 'failed', code: `http_${res.status}`, ...(res.status === 403 || res.status === 404 || res.status === 410 ? { gone: true } : {}) }
  } catch (err) {
    const name = (err as { name?: string } | null)?.name
    const cause = (err as { cause?: { name?: string; code?: string } } | null)?.cause
    if (name === 'SsrfError' || cause?.name === 'SsrfError') return { status: 'failed', code: 'blocked_address' }
    // Log the class of the problem only: an undici message can name the host, and nothing here may name the path.
    Logger.debug?.(`[observability.chat] ${kind} post failed: ${redactSecrets(name ?? 'error')}${cause?.code ? ` (${cause.code})` : ''}`)
    return { status: 'retry', code: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' }
  }
}

/** Up to `CHAT_MAX_ATTEMPTS` attempts with backoff; a `failed` outcome stops at once. Never throws. */
export async function postChat(kind: ChatKind, url: string, payload: Record<string, unknown>): Promise<ChatSendOutcome> {
  let last: ChatSendOutcome = { status: 'failed', code: 'not_attempted' }
  for (let attempt = 0; attempt < CHAT_MAX_ATTEMPTS; attempt++) {
    last = await postChatOnce(kind, url, payload)
    if (last.status !== 'retry') return last
    if (attempt < CHAT_MAX_ATTEMPTS - 1) await wait(last.retryAfterMs ?? BACKOFF_MS[attempt] ?? BACKOFF_MS.at(-1)!)
  }
  return last
}

/** Is a closed code safe to store and show? (It always is, by construction; the check keeps a future edit honest.) */
export function isChatCode(code: string): boolean {
  return /^[a-z0-9_]{2,40}$/.test(code)
}
