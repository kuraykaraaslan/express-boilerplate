import { z } from 'zod'
import { matchesAllowEntry } from '@kuraykaraaslan-labs/common/server/ip-guard'

/**
 * The pure rules of a status page (observability phase 15): what a slug, a host, a locale and an address allow-list may look like,
 * which components a page shows, and whether an address is on a list. No I/O, so every rule is testable on its own and the services
 * only wire them to storage.
 */

export const StatusAudienceEnum = z.enum(['PUBLIC', 'PASSWORD', 'AUTHENTICATED', 'IP'])
export type StatusAudience = z.infer<typeof StatusAudienceEnum>

export const StatusThemeEnum = z.enum(['AUTO', 'LIGHT', 'DARK'])
export type StatusTheme = z.infer<typeof StatusThemeEnum>

/** The slug of the default page. Not reserved from others by accident: `default` is the one name the legacy URL maps to. */
export const DEFAULT_PAGE_SLUG = 'default'

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/** A slug is lowercase letters, digits and inner dashes, 1 to 64 characters. Anything else is not a page, and not an error worth explaining. */
export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_RE.test(value)
}

const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/

export function isLocaleCode(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 12 && LOCALE_RE.test(value)
}

/** `en-GB` -> `en-gb`: one spelling per language so a lookup never misses on case. */
export function normalizeLocale(value: string): string {
  return value.trim().toLowerCase()
}

const HOST_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/**
 * A DNS host name as a status page may be bound to it: lowercase, at least two labels, letters/digits/dashes, no port, no IP literal
 * and no `localhost`. A page host is a claim a tenant makes about DNS, not a place to point the app at.
 */
export function normalizeHostname(value: string): string | null {
  const host = value.trim().toLowerCase().replace(/\.$/, '')
  if (host.length === 0 || host.length > 253) return null
  const labels = host.split('.')
  if (labels.length < 2) return null
  if (!labels.every((l) => HOST_LABEL.test(l))) return null
  if (labels.every((l) => /^\d+$/.test(l))) return null // an IPv4 literal
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  return host
}

/**
 * An allow-list entry: an IPv4 / IPv6 address or a CIDR block. Checked by shape here (the matcher decides membership), so a typo is
 * refused when it is written rather than quietly matching nobody.
 */
export function isIpEntry(entry: string): boolean {
  const e = entry.trim()
  if (e.length === 0 || e.length > 64) return false
  const [base, bits, extra] = e.split('/')
  if (extra !== undefined) return false
  const v6 = base.includes(':')
  if (v6) {
    if (!/^[0-9a-fA-F:.]+$/.test(base)) return false
    if (!base.includes('::') && base.split(':').length !== 8 && !/\d+\.\d+\.\d+\.\d+$/.test(base)) return false
  } else {
    const parts = base.split('.')
    if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return false
  }
  if (bits === undefined) return true
  if (!/^\d{1,3}$/.test(bits)) return false
  return Number(bits) <= (v6 ? 128 : 32)
}

/** Whether `ip` is on the list. An empty or missing list admits nobody: an IP page with no addresses is closed, not open. */
export function ipAllowed(ip: string | null | undefined, allowlist: readonly string[] | null | undefined): boolean {
  if (!ip || ip === 'unknown' || !allowlist || allowlist.length === 0) return false
  return allowlist.some((entry) => matchesAllowEntry(ip, entry))
}

/** Origins that may frame the widget: `https://host[:port]` only, no path, no wildcard. */
export function normalizeOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim())
    if (u.protocol !== 'https:') return null
    if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) return null
    if (u.hostname.includes('*')) return null
    return u.origin
  } catch { return null }
}

export interface PageComponentView {
  componentId: string
  isPublic: boolean
}

/**
 * The components a page shows.
 *
 *  - `selection` null: every component marked public (the original page).
 *  - `selection` set: exactly those, in the order the components arrive.
 *  - A PUBLIC page can never show a component that is not public, whatever the selection says: the selection is a filter, not a way
 *    to publish something an operator kept internal. Only a restricted audience (password, signed-in members, an address list) may
 *    show an internal component, because for them it is the point.
 */
export function visibleComponents<T extends PageComponentView>(
  components: readonly T[],
  page: { audience: StatusAudience; componentIds: readonly string[] | null | undefined },
): T[] {
  const sel = page.componentIds ? new Set(page.componentIds) : null
  return components.filter((c) => {
    if (page.audience === 'PUBLIC' && !c.isPublic) return false
    if (sel === null) return c.isPublic
    return sel.has(c.componentId)
  })
}

/** Does an incident touch a page? One that names no component touches every page; one that names some must share a component with it. */
export function incidentTouchesPage(affectedComponentIds: readonly string[] | null | undefined, pageComponentIds: ReadonlySet<string>): boolean {
  if (!affectedComponentIds || affectedComponentIds.length === 0) return true
  return affectedComponentIds.some((id) => pageComponentIds.has(id))
}
