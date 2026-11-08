/**
 * Shared bits of the static renderers (feeds, calendar, badge, widget, snapshot): escaping, the status vocabulary and the URL gate.
 * Every renderer is a pure function of a `PublicPage` produced by the one serializer, so nothing here ever sees an entity.
 */

/** Escape text for an XML or HTML text node or a double-quoted attribute. Control characters (other than tab and newline) are dropped. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Only an absolute https URL may be written into a page as a link or an image source; anything else becomes null. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return u.toString()
  } catch { return null }
}

export const STATUS_LABELS: Record<string, string> = {
  OPERATIONAL: 'Operational',
  DEGRADED: 'Degraded performance',
  PARTIAL_OUTAGE: 'Partial outage',
  MAJOR_OUTAGE: 'Major outage',
  MAINTENANCE: 'Maintenance',
}

export const BANNER_LABELS: Record<string, string> = {
  OPERATIONAL: 'All systems operational',
  DEGRADED: 'Some systems are degraded',
  PARTIAL_OUTAGE: 'Partial system outage',
  MAJOR_OUTAGE: 'Major system outage',
  MAINTENANCE: 'Scheduled maintenance in progress',
}

/** Semantic colours. A brand colour never replaces one of these: repainting an outage in a brand colour makes it look fine. */
export const STATUS_HEX: Record<string, string> = {
  OPERATIONAL: '#16a34a',
  DEGRADED: '#d97706',
  PARTIAL_OUTAGE: '#ea580c',
  MAJOR_OUTAGE: '#dc2626',
  MAINTENANCE: '#0284c7',
  NO_DATA: '#9ca3af',
}

export const statusLabel = (s: string) => STATUS_LABELS[s] ?? 'Unknown'
export const statusHex = (s: string) => STATUS_HEX[s] ?? '#6b7280'

/** A `#rgb` / `#rrggbb` colour or null: the only shape of a tenant colour that is ever put into a style attribute. */
export function safeHexColor(value: string | null | undefined): string | null {
  return value && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : null
}
