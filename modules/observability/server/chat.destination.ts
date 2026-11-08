import { createHash } from 'node:crypto'

/**
 * Where incident posts and status-page chat subscriptions may go (observability phase 14.7 and 15.5): a Slack or Microsoft Teams
 * INCOMING WEBHOOK URL. Pure, no I/O, so every refusal is pinned by a table test.
 *
 * The URL IS the credential. Neither Slack nor Teams signs an incoming webhook or accepts a signature: whoever holds the URL can post
 * into the channel. So it is treated like a password everywhere in this module: validated against an allow-list of the vendors' own hosts
 * before it is stored, stored encrypted, shown only as its host, never logged, and never returned by any API after it was written.
 *
 * Hosts, from the vendors' documentation (read 2026-10-18):
 *  - Slack, "Sending messages using incoming webhooks": https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
 *    ("Each webhook is a unique URL on hooks.slack.com/services/..."; GovSlack uses the slack-gov.com domain).
 *  - Teams, "Create an Incoming Webhook": https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 *    (Microsoft 365 connector URLs are `https://<tenant>.webhook.office.com/webhookb2/...`; Microsoft is retiring connectors in favour of
 *    the Workflows app, "When a Teams webhook request is received", whose URL is on `*.logic.azure.com` (legacy form, `prod-NN.<region>.
 *    logic.azure.com`) or, since the August 2025 migration, `<environment>.<n>.environment.api.powerplatform.com`.)
 * Re-check 2026-10-18: the Learn page confirms `<tenant>.webhook.office.com` and the Adaptive Card envelope; third-party guides confirm `prod-NN.<region>.logic.azure.com:443`.
 * The `environment.api.powerplatform.com` form is from Microsoft's Power Automate URL migration announcement and was NOT visible on the pages re-read; it is a
 * Microsoft-owned wildcard, so keeping it costs nothing in SSRF terms, but drop it if Microsoft's documentation does not bear it out.
 * A Teams host that Microsoft adds later is a deliberate one-line change here, never a pattern a tenant can widen.
 */

export type ChatKind = 'SLACK' | 'TEAMS'
export const CHAT_KINDS: readonly ChatKind[] = ['SLACK', 'TEAMS']

export const SLACK_HOSTS: readonly string[] = ['hooks.slack.com', 'hooks.slack-gov.com']
/** A Teams host must END with one of these AND have at least one label before it (`x.webhook.office.com`, never the bare suffix). */
export const TEAMS_HOST_SUFFIXES: readonly string[] = ['.webhook.office.com', '.logic.azure.com', '.environment.api.powerplatform.com']

/** The SAS-signed Workflows URLs can run past 255 characters (Microsoft says so); anything beyond this is not a webhook URL. */
export const MAX_CHAT_URL = 2048

export type ChatUrlRefusal =
  | 'too_long' | 'malformed' | 'not_https' | 'userinfo' | 'port' | 'fragment' | 'control_chars' | 'host_not_allowed' | 'path_not_allowed'

export type ChatUrlCheck = { ok: true; url: string; host: string } | { ok: false; reason: ChatUrlRefusal }

const CONTROL_OR_SPACE = /[\x00-\x20\x7f-\x9f\\]/

function hostAllowed(kind: ChatKind, host: string): boolean {
  if (host.endsWith('.') || host.includes('..')) return false
  if (kind === 'SLACK') return SLACK_HOSTS.includes(host)
  return TEAMS_HOST_SUFFIXES.some((suffix) => host.length > suffix.length && host.endsWith(suffix) && !host.startsWith('.'))
}

/**
 * Judge a destination URL. Never resolves DNS (that is the sender's job, pinned at connect time); this is the part a tenant's text can
 * be wrong about: scheme, userinfo, port, fragment, host, path. A raw string carrying whitespace, a backslash or a control character is
 * refused BEFORE parsing, because the WHATWG parser silently strips tabs and newlines and turns a backslash into a slash, which is how
 * `https://hooks.slack.com\@evil.example/` and its relatives get through a naive check.
 */
export function checkChatUrl(kind: ChatKind, raw: unknown): ChatUrlCheck {
  if (typeof raw === 'string' && testHostSeam?.length) {
    // Test lane only (see `setChatUrlTestHostsForTests`): a plain http URL on a loopback host the test itself listens on.
    try {
      const u = new URL(raw)
      if (u.protocol === 'http:' && testHostSeam.includes(u.hostname) && !u.username && !u.password) return { ok: true, url: u.href, host: u.hostname }
    } catch { /* falls through to the real check, which refuses it */ }
  }
  if (typeof raw !== 'string') return { ok: false, reason: 'malformed' }
  if (raw.length > MAX_CHAT_URL) return { ok: false, reason: 'too_long' }
  if (CONTROL_OR_SPACE.test(raw)) return { ok: false, reason: 'control_chars' }
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'malformed' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not_https' }
  if (u.username || u.password) return { ok: false, reason: 'userinfo' }
  if (u.port && u.port !== '443') return { ok: false, reason: 'port' }
  if (u.hash) return { ok: false, reason: 'fragment' }
  const host = u.hostname.toLowerCase()
  if (!hostAllowed(kind, host)) return { ok: false, reason: 'host_not_allowed' }
  const path = u.pathname
  if (kind === 'SLACK') {
    // /services/T.../B.../token: three non-empty segments after /services/
    const parts = path.split('/').filter(Boolean)
    if (parts[0] !== 'services' || parts.length < 4 || parts.some((p) => p === '.' || p === '..')) return { ok: false, reason: 'path_not_allowed' }
  } else if (path === '/' || path === '') {
    return { ok: false, reason: 'path_not_allowed' }
  }
  return { ok: true, url: u.href, host }
}

let testHostSeam: readonly string[] | null = null
/**
 * Test seam for the LIVE lane: lets `checkChatUrl` accept `http://<host>` for the given loopback hosts, so a real local HTTP server can stand in for the
 * vendor. Everything else (the vendor allow-list, userinfo, https, ...) stays as it is, and the address guard of `safeFetch` is NOT relaxed by this (the
 * test widens that separately, through the sender seam). Never reads configuration or the environment; refuses to be set in production.
 */
export function setChatUrlTestHostsForTests(hosts: readonly string[] | null): void {
  if (hosts && process.env.NODE_ENV === 'production') throw new Error('the chat URL test seam is for tests only')
  testHostSeam = hosts
}

/** Does this look like ANY chat destination host (either kind)? Used to keep such a URL out of free-text fields and logs. */
export function chatUrlPattern(): RegExp {
  return /https?:\/\/(?:hooks\.slack(?:-gov)?\.com|[a-z0-9.-]+\.(?:webhook\.office\.com|logic\.azure\.com|environment\.api\.powerplatform\.com))[^\s"'<>)]*/gi
}

/**
 * Remove anything credential-shaped from a text before it is stored in a log row, an error column or a message: webhook URLs of the two
 * vendors, bearer tokens, and `key=value` pairs whose key names a secret. Defence in depth: nothing here is supposed to carry one.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(chatUrlPattern(), '[redacted-url]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\b(token|secret|password|passwd|api[_-]?key|authorization|sig|signature)(["']?\s*[:=]\s*["']?)[^\s"'&,;]{3,}/gi, '$1$2[redacted]')
    .replace(/\bxox[abposr]-[A-Za-z0-9-]{8,}/g, '[redacted-token]')
}

/** What every view shows of a destination: the host and nothing of the path (the path is the secret). */
export function maskChatUrl(host: string | null | undefined): string {
  return host ? `https://${host}/…` : ''
}

/** Stable per-tenant fingerprint for uniqueness ("this channel is already connected") without keeping the URL in the clear. */
export function chatUrlFingerprint(tenantId: string, url: string): string {
  return createHash('sha256').update(`chat-url\n${tenantId}\n${url}`).digest('hex')
}
