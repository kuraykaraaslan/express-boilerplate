import { normalizeEmbedHost, resolveEmbedUrl } from '@kuraykaraaslan-labs/common/server/widget-settings/views/content-logic'
import { resolvePlacement } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/resolve'
import type { BuiltinKindSpec } from '@kuraykaraaslan-labs/common/server/widget-settings/kind'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DASHBOARD_SETTING_KEYS } from './dashboard.setting.keys'
import MSG from './dashboard.messages'
import { DASHBOARD_ISSUE_CODES, type DashboardWireIssue } from './settings-issue-codes'

export { DASHBOARD_SETTING_KEYS, DASHBOARD_KEYS } from './dashboard.setting.keys'

/** More entries than any real list; a pasted blob cannot make every card scan thousands of patterns. */
export const MAX_EMBED_HOSTS = 100

/**
 * The stored text as a list: split on lines, commas and spaces, normalised by the same rule the cards apply
 * (`normalizeEmbedHost`), invalid entries dropped, duplicates removed, capped.
 */
export function parseEmbedHosts(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  const out = new Set<string>()
  for (const part of raw.split(/[\s,]+/)) {
    const host = normalizeEmbedHost(part)
    if (host) out.add(host)
    if (out.size >= MAX_EMBED_HOSTS) break
  }
  return [...out]
}

/** The tenant's allow-list. A read failure allows nothing, the same as an empty list. */
export async function getEmbedHosts(tenantId: string): Promise<string[]> {
  // Imported on use: the placement service imports this file, and only an embed save needs the settings store.
  const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')
  const raw = await SettingService.getValue(tenantId, DASHBOARD_SETTING_KEYS.EMBED_HOSTS).catch(() => null)
  return parseEmbedHosts(raw)
}

/** The address an embed card's settings frame: the stored layers over the definition's defaults. */
function embedUrlOf(kind: BuiltinKindSpec, settings: Record<string, unknown> | null | undefined, definitionDefaults: Record<string, unknown> | null): unknown {
  return resolvePlacement({ template: kind.template, slotCount: kind.slots.length, settings: settings ?? null, board: null, definitionDefaults }).settings.url
}

/**
 * Save-time half of the allow-list: a placement may not POINT an embed card at a site the tenant does not allow.
 * Only a changed address is checked, so a card whose site was removed from the list later can still be edited
 * otherwise (the card itself refuses to frame it). `null` when the save may go ahead, else the host.
 */
export async function embedHostIssue(
  tenantId: string,
  kind: BuiltinKindSpec,
  settings: Record<string, unknown>,
  previous: Record<string, unknown> | null | undefined,
  definitionDefaults: Record<string, unknown> | null,
): Promise<string | null> {
  if (kind.type !== 'content.embed') return null
  const url = embedUrlOf(kind, settings, definitionDefaults)
  if (previous && url === embedUrlOf(kind, previous, definitionDefaults)) return null
  const checked = resolveEmbedUrl(url, await getEmbedHosts(tenantId))
  return !checked.ok && checked.reason === 'notAllowed' ? checked.host : null
}

/**
 * The 422 for an embed card pointed at a site off the allow-list: the English message with the host (logs, API
 * callers), and a `details.issues` entry on the card's `url` field with the host, which the board UI words in the
 * viewer's language under that field (`DASHBOARD_ISSUE_CODES.EMBED_HOST_NOT_ALLOWED`).
 */
export function embedHostRefusedError(host: string): AppError {
  const issue: DashboardWireIssue = {
    path: 'url',
    message: `${MSG.EMBED_HOST_NOT_ALLOWED}: ${host}`.slice(0, 500),
    code: DASHBOARD_ISSUE_CODES.EMBED_HOST_NOT_ALLOWED,
    params: { host: host.slice(0, 253) },
  }
  return new AppError(`${MSG.EMBED_HOST_NOT_ALLOWED}: ${host}`, 422, ErrorCode.VALIDATION_ERROR, { details: { issues: [issue] } })
}
