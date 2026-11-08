/**
 * The words that leave for Slack and Microsoft Teams (observability phase 14.7 and 15.5): a neutral message model, and two pure
 * renderers. No I/O, no clock, no environment, so every injection canary is a table test.
 *
 * Formats, from the vendors' documentation (read 2026-10-18):
 *  - Slack incoming webhook body: `text` (the fallback / notification text, which is mrkdwn) plus `blocks`, here inside one `attachments`
 *    entry so the severity colour bar shows. Block Kit `header`, `section` (with `fields`), `actions` and `context` blocks. Control
 *    characters in mrkdwn text are `&`, `<` and `>`, which must be written `&amp;`, `&lt;` and `&gt;`:
 *    https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks and https://docs.slack.dev/messaging/formatting-message-text
 *  - Teams (Workflows "When a Teams webhook request is received", and the legacy Microsoft 365 connector URL): an Adaptive Card wrapped as
 *    `{ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: <card> }] }`, 28 KB at most.
 *    The legacy MessageCard format is not used: Microsoft's page says Workflows supports both but that Message Card "button rendering
 *    won't be supported", and connectors are being retired: https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 *    Teams text fields accept basic Markdown only and ignore HTML.
 *
 * The trust model: every string that a person typed (a title, a message, a component name, a reason) is data. It is defanged here, in one
 * place, before it reaches either renderer: angle brackets become single guillemets so no `<!channel>`, `<@U123>`, `<https://x|y>` or
 * HTML tag survives anywhere; control characters go; the length is bounded. The mrkdwn fallback is additionally escaped with the `&amp;`
 * rules, and the Teams text with backslashes before Markdown punctuation. The links in a message are never taken from a person's text:
 * they are built by the caller from the platform's own origin and an id.
 */

export const CHAT_EVENTS = [
  'incident.created', 'incident.updated', 'incident.acknowledged', 'incident.mitigated', 'incident.resolved', 'incident.postmortem_published',
] as const
export type ChatEvent = typeof CHAT_EVENTS[number]

/** Events a destination that is flagged PUBLIC may ever receive: the ones about what the public page itself says. */
export const PUBLIC_CHAT_EVENTS: readonly ChatEvent[] = ['incident.created', 'incident.updated', 'incident.resolved']

export type ChatSeverity = 'MINOR' | 'MAJOR' | 'CRITICAL'

/** What a message is made of. Built by `chat.projection.ts`, which decides what a destination may know; this file only draws. */
export interface ChatMessageModel {
  /** `incident.created` … or `test`, or `status.confirm` for the subscriber confirmation. */
  kind: ChatEvent | 'test' | 'status.confirm' | 'status.maintenance'
  headline: string
  title: string
  severity?: ChatSeverity | null
  /** `OPEN` | `RESOLVED` | free label for the test and confirmation messages. */
  status?: string | null
  components?: string[]
  /** The words of a public update, or the reason of an internal post. Already judged by the projection. */
  body?: string | null
  /** An absolute https URL built by the platform, never by a person. */
  linkUrl?: string | null
  linkLabel?: string | null
  /** Footer line: the unsubscribe link of a subscriber post, or a hint. */
  footer?: string | null
  footerUrl?: string | null
  footerUrlLabel?: string | null
}

const LIMITS = { headline: 150, title: 300, body: 1500, component: 80, components: 12, footer: 300, label: 40 } as const

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/** Defang a person's text: no control or bidi characters, no angle brackets, bounded. Newlines are kept (a message can have lines). */
export function defang(text: unknown, max: number): string {
  const s = typeof text === 'string' ? text : text == null ? '' : String(text)
  const cleaned = s.replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/</g, '\u2039').replace(/>/g, '\u203a').replace(/\n{3,}/g, '\n\n').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

/** Slack's three control characters, for text that IS mrkdwn (the fallback `text`). Input must already be defanged or fixed text. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Backslash before the Markdown punctuation Teams' basic Markdown (bold, italic, links, code) acts on. Deliberately NOT every ASCII
 * punctuation mark: a renderer that did not honour an escape would show the backslash, and hyphens in a date should stay plain. A line
 * that starts like a list item is the one cosmetic leak; it cannot create a link or a mention.
 */
export function teamsEscape(text: string): string {
  return text.replace(/([\\`*_[\]()])/g, '\\$1')
}

/** A link target must be an absolute http(s) URL without whitespace or angle brackets, or it is not rendered at all. */
export function safeLink(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 2000 || /[\s<>"'|\\]/.test(url)) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch { return null }
}

const SLACK_COLOUR: Record<string, string> = { CRITICAL: '#D92D20', MAJOR: '#F79009', MINOR: '#FDB022', RESOLVED: '#12B76A', INFO: '#5B6B8C' }
const TEAMS_COLOUR: Record<string, 'Attention' | 'Warning' | 'Good' | 'Accent'> = { CRITICAL: 'Attention', MAJOR: 'Warning', MINOR: 'Warning', RESOLVED: 'Good', INFO: 'Accent' }

/** `RESOLVED` beats severity for the colour: a closed incident is green whatever it was. */
function toneOf(m: ChatMessageModel): 'CRITICAL' | 'MAJOR' | 'MINOR' | 'RESOLVED' | 'INFO' {
  if (m.kind === 'incident.resolved' || m.status === 'RESOLVED' || m.status === 'COMPLETED') return 'RESOLVED'
  if (m.severity === 'CRITICAL' || m.severity === 'MAJOR' || m.severity === 'MINOR') return m.severity
  return 'INFO'
}

interface Clean {
  headline: string; title: string; severity: string | null; status: string | null; components: string[]; body: string | null
  linkUrl: string | null; linkLabel: string; footer: string | null; footerUrl: string | null; footerUrlLabel: string
}

function clean(m: ChatMessageModel): Clean {
  const components = (m.components ?? []).slice(0, LIMITS.components).map((c) => defang(c, LIMITS.component)).filter(Boolean)
  const more = (m.components?.length ?? 0) - components.length
  if (more > 0) components.push(`+${more} more`)
  return {
    headline: defang(m.headline, LIMITS.headline), title: defang(m.title, LIMITS.title),
    severity: m.severity ? defang(m.severity, 12) : null, status: m.status ? defang(m.status, 24) : null,
    components, body: m.body ? defang(m.body, LIMITS.body) : null,
    linkUrl: safeLink(m.linkUrl), linkLabel: defang(m.linkLabel ?? 'Open', LIMITS.label) || 'Open',
    footer: m.footer ? defang(m.footer, LIMITS.footer) : null,
    footerUrl: safeLink(m.footerUrl), footerUrlLabel: defang(m.footerUrlLabel ?? 'Unsubscribe', LIMITS.label) || 'Unsubscribe',
  }
}

/** The one-line summary used for notifications and as the Slack fallback `text`. */
function summary(c: Clean): string {
  return `${c.headline}: ${c.title}${c.severity ? ` (${c.severity})` : ''}`
}

/** The Slack incoming-webhook body. */
export function toSlack(model: ChatMessageModel): Record<string, unknown> {
  const c = clean(model)
  const plain = (text: string) => ({ type: 'plain_text', text, emoji: false })
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: plain(c.headline) },
    { type: 'section', text: plain(c.title) },
  ]
  const fields: Record<string, unknown>[] = []
  if (c.severity) fields.push(plain(`Severity: ${c.severity}`))
  if (c.status) fields.push(plain(`Status: ${c.status}`))
  if (c.components.length) fields.push(plain(`Affected: ${c.components.join(', ')}`.slice(0, 2000)))
  if (fields.length) blocks.push({ type: 'section', fields })
  if (c.body) blocks.push({ type: 'section', text: plain(c.body) })
  if (c.linkUrl) {
    // The URL is platform-built and checked by safeLink (no `|`, `<`, `>` or whitespace), so it cannot close the mrkdwn link early.
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `<${c.linkUrl}|${slackEscape(c.linkLabel)}>` } })
  }
  const footerBits: string[] = []
  if (c.footer) footerBits.push(slackEscape(c.footer))
  if (c.footerUrl) footerBits.push(`<${c.footerUrl}|${slackEscape(c.footerUrlLabel)}>`)
  if (footerBits.length) blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: footerBits.join(' · ') }] })
  // No link expansion: a bot that unfurls the confirmation or unsubscribe link in a channel would otherwise "click" it for a human.
  return { text: slackEscape(summary(c)), unfurl_links: false, unfurl_media: false, attachments: [{ color: SLACK_COLOUR[toneOf(model)], blocks }] }
}

/** The Teams incoming-webhook / Workflows body: an Adaptive Card in a `message` envelope. */
export function toTeams(model: ChatMessageModel): Record<string, unknown> {
  const c = clean(model)
  const tone = TEAMS_COLOUR[toneOf(model)]
  const text = (t: string, extra: Record<string, unknown> = {}) => ({ type: 'TextBlock', text: teamsEscape(t), wrap: true, ...extra })
  const body: Record<string, unknown>[] = [
    text(c.headline, { weight: 'Bolder', size: 'Medium', color: tone }),
    text(c.title, { weight: 'Bolder', spacing: 'Small' }),
  ]
  const facts: { title: string; value: string }[] = []
  if (c.severity) facts.push({ title: 'Severity', value: teamsEscape(c.severity) })
  if (c.status) facts.push({ title: 'Status', value: teamsEscape(c.status) })
  if (c.components.length) facts.push({ title: 'Affected', value: teamsEscape(c.components.join(', ')) })
  if (facts.length) body.push({ type: 'FactSet', facts })
  if (c.body) body.push(text(c.body))
  if (c.footer) body.push(text(c.footer, { isSubtle: true, size: 'Small', spacing: 'Medium' }))
  const actions: Record<string, unknown>[] = []
  if (c.linkUrl) actions.push({ type: 'Action.OpenUrl', title: c.linkLabel, url: c.linkUrl })
  if (c.footerUrl) actions.push({ type: 'Action.OpenUrl', title: c.footerUrlLabel, url: c.footerUrl })
  const card: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body,
    ...(actions.length ? { actions } : {}), msteams: { width: 'Full' },
  }
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] }
}

export function formatFor(kind: 'SLACK' | 'TEAMS', model: ChatMessageModel): Record<string, unknown> {
  return kind === 'SLACK' ? toSlack(model) : toTeams(model)
}

/** The Teams limit; a body over it is refused by Teams with an error, so the sender refuses first. */
export const TEAMS_MAX_BYTES = 28 * 1024
