import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardElementActionsLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.element_actions'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { ELEMENT_ACTIONS_POINT, type ElementActionsProvider, type ElementCommandEntry } from './element-actions.types'
import { isDeepStrictEqual } from 'node:util'
import { elementCommandEntries, isElementCommandSource, normalizeInstanceActions, type NormalizedEntry } from './instance-actions'

export { ELEMENT_ACTIONS_POINT }

/**
 * The `dashboard:element_actions` provider of a widget type for a tenant, or null when none serves it: nothing contributes
 * one for the type, the contributing module is not active for the tenant, or the provider failed to load. The dashboard never
 * names a contributor; the type is matched on the contribution's `metadata.widgetType`.
 */
export async function elementActionsFor(tenantId: string, widgetType: string | undefined | null): Promise<ElementActionsProvider | null> {
  if (!widgetType) return null
  try {
    const ctx = tenantCtx(tenantId)
    const served = (await ext.contributions(ELEMENT_ACTIONS_POINT, ctx)).find((c) => c.metadata?.widgetType === widgetType)
    if (!served?.key) return null
    const selected = await ext.select<ElementActionsProvider>(ELEMENT_ACTIONS_POINT, ctx, dashboardElementActionsLoaders, { key: served.key })
    return selected?.impl ?? null
  } catch {
    return null
  }
}

/**
 * The permission each widget type's provider asks for to author a command entry, by widget type, for the providers that name one
 * and are active for the tenant. The dashboard never names a permission: it only relays what the providers declare.
 */
export async function elementAuthoringPermissions(tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const served = await ext.contributions(ELEMENT_ACTIONS_POINT, tenantCtx(tenantId))
    for (const c of served) {
      const widgetType = c.metadata?.widgetType
      if (typeof widgetType !== 'string') continue
      const permission = (await elementActionsFor(tenantId, widgetType))?.authoringPermission
      if (permission) out[widgetType] = permission
    }
  } catch {
    // A failing contribution lookup offers no authoring: the save still asks the provider, this only hides an option.
  }
  return out
}

/** The command entries on element gestures of these actions, as a provider reads them. */
export const elementCommandsOf = (actions: unknown): ElementCommandEntry[] => elementCommandEntries(actions)

/**
 * Does the caller hold this permission? Asked lazily and only for a permission a provider names (`authoringPermission`), so
 * the dashboard never names one itself. The routes build it from the caller's session (`elementAuthoringFor`); a write with
 * no caller to ask (a trusted internal one) passes none, and a placement save that needs the permission then refuses.
 */
export type ElementAuthoring = (permission: string) => Promise<boolean>

/** An entry as JSON holds it (undefined properties gone), so a stored row and a parsed body compare equal when they say the same. */
const plain = (entry: unknown): unknown => JSON.parse(JSON.stringify(entry))

/** The command entries that are NEW or CHANGED against the stored ones (an unchanged entry may stay, a moved or edited one is a change). */
export function changedElementCommands(entries: ElementCommandEntry[], stored: unknown): ElementCommandEntry[] {
  const before = elementCommandsOf(stored).map(plain)
  return entries.filter((entry) => {
    const now = plain(entry)
    return !before.some((old) => isDeepStrictEqual(old, now))
  })
}

/** Throws 403 when the entries are new or changed against `stored` and the provider names a permission the caller does not hold. */
async function assertAuthoringPermission(
  provider: ElementActionsProvider, entries: ElementCommandEntry[], stored: unknown, authoring: ElementAuthoring | undefined,
): Promise<void> {
  const permission = provider.authoringPermission
  if (!permission || changedElementCommands(entries, stored).length === 0) return
  if (!authoring || !(await authoring(permission))) throw new AppError(MSG.ELEMENT_COMMAND_AUTHORING_FORBIDDEN, 403, ErrorCode.FORBIDDEN)
}

/**
 * Write-time check of the commands on a placement's element gestures (create, update, template apply, import). Nothing to
 * check when no element gesture has a command. Otherwise the provider of the placement's widget type must serve it (422 when
 * none does: commands on this widget's elements are not available), the caller must hold the provider's `authoringPermission`
 * when an entry is new or changed against `stored` (403), and the provider must accept every entry for the settings the
 * placement will hold. `kindType` is looked up by the caller only when {@link elementCommandsOf} is not empty.
 */
export async function assertElementCommands(
  tenantId: string, kindType: string | undefined, settings: unknown, actions: unknown,
  options: { stored?: unknown; authoring?: ElementAuthoring } = {},
): Promise<void> {
  const entries = elementCommandsOf(actions)
  if (entries.length === 0) return
  const provider = await elementActionsFor(tenantId, kindType)
  if (!provider || !provider.allowsCommands(settings)) throw new AppError(MSG.ELEMENT_COMMAND_NOT_ON_SCENE, 422, ErrorCode.VALIDATION_ERROR)
  await assertAuthoringPermission(provider, entries, options.stored, options.authoring)
  provider.validateEntries(await elementSettingsOf(tenantId, provider, settings), entries)
}

/**
 * A copy (board duplicate) keeps the stored entries, but the copy is a new placement the caller authors: when the provider of
 * the widget's kind names a permission the caller lacks, the copy drops its element command entries instead (counted, like the
 * commands the caller could not run). Untouched input comes back as the same value.
 */
export async function dropElementCommandsWithoutPermission(
  tenantId: string, kindType: string | undefined, raw: unknown, authoring: ElementAuthoring | undefined,
): Promise<{ actions: unknown; dropped: number }> {
  if (elementCommandsOf(raw).length === 0) return { actions: raw ?? null, dropped: 0 }
  const permission = (await elementActionsFor(tenantId, kindType))?.authoringPermission
  if (!permission || (authoring && (await authoring(permission)))) return { actions: raw, dropped: 0 }
  const n = normalizeInstanceActions(raw)!
  let dropped = 0
  const sources: Record<string, NormalizedEntry[]> = {}
  for (const [key, list] of Object.entries(n.sources)) {
    const kept = list.filter((e) => {
      if (!isElementCommandSource(key) || e.action.kind !== 'command') return true
      dropped++
      return false
    })
    if (kept.length > 0) sources[key] = kept
  }
  return { actions: Object.keys(sources).length > 0 ? { v: 2, sources } : null, dropped }
}

/**
 * New settings with the actions the placement already stores: 409 when they remove or rename an element a stored command
 * still hangs off (a board page that is still opened by an action is refused the same way). A provider that is gone for the
 * type cannot judge it, and the stored commands cannot run without it either, so nothing is refused then.
 */
export async function assertSettingsKeepElementCommands(tenantId: string, kindType: string | undefined, settings: unknown, stored: unknown): Promise<void> {
  const entries = elementCommandsOf(stored)
  if (entries.length === 0) return
  const provider = await elementActionsFor(tenantId, kindType)
  if (provider) provider.keepsEntries(await elementSettingsOf(tenantId, provider, settings), entries)
}

/** The settings a provider's element checks read for a placement's settings (`ElementActionsProvider.elementSettings`): the placement's own unless the provider says more. */
export async function elementSettingsOf(tenantId: string, provider: ElementActionsProvider, settings: unknown): Promise<unknown> {
  return provider.elementSettings ? provider.elementSettings(tenantId, settings) : settings
}
