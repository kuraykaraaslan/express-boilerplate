import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import MSG from './dashboard.messages'
import { WIDGET_KINDS_POINT } from './widget-kind-group.types'
import { BUILTIN_KINDS, builtinKind } from '@kuraykaraaslan-labs/common/server/widget-settings/templates/index'
import { builtinTypeOfComponent } from './builtin-component-files'
import type { SceneContract } from './ext-widget'

export { WIDGET_KINDS_POINT }

/**
 * Which builtin widget kinds a tenant may use, from the kit's `group` tag and the `dashboard:widget_kinds` contributions
 * (tasks 28.1 and 28.3).
 *
 * The widget kit tags a builtin kind with an optional product `group` (`scada.scene` carries `scada`). A module that sells such a
 * group contributes to `dashboard:widget_kinds` with `key` = the group id. A grouped kind is offered, published and accepted
 * only while an ACTIVE contributor of its group exists for the tenant (the platform's per-tenant module switch and the licence
 * entitlement, both through the extension runtime's contributor states). With no contributor at all (the module is not in the
 * build, or it is off) the kind is hidden and refused. A kind without a group is never gated. The dashboard names no contributor
 * and no kind here: the tag lives on the kit's kind spec, the key on the contribution.
 *
 * Reads only the contributions' static records (`ext.states`); no module code is loaded. An unreadable state degrades to
 * "nothing is blocked" (the runtime's own rule: an unreadable state is our failure, not a reason to switch features off).
 */

/** The product group of a builtin kind type (`BuiltinKindSpec.group`), or undefined for an ungrouped or unknown kind. */
export const groupOfKind = (type: string): string | undefined => builtinKind(type)?.group

/**
 * The builtin kind type a widget row renders with (the same rule as `kindForWidget`, without its template engine: a row's
 * `builtin:<type>` settings template, else the type its first-party component renders), or undefined for any other widget.
 */
export function kindTypeOf(widget: { settingsTemplate?: { id: string } | null; componentId?: string | null } | null | undefined): string | undefined {
  const id = widget?.settingsTemplate?.id
  if (id?.startsWith('builtin:')) return id.slice('builtin:'.length)
  return builtinTypeOfComponent(widget?.componentId)
}

/** The kind types a tenant may NOT use: grouped by the kit, and no ACTIVE contributor of the group exists for the tenant. */
export async function blockedKindTypes(tenantId: string): Promise<Set<string>> {
  let states: Awaited<ReturnType<typeof ext.states>>
  try {
    states = await ext.states(WIDGET_KINDS_POINT, tenantCtx(tenantId))
  } catch {
    return new Set()
  }
  const active = new Set(states.filter((s) => s.state === 'active').map((s) => s.contribution.key))
  return new Set(BUILTIN_KINDS.filter((k) => k.group && !active.has(k.group)).map((k) => k.type))
}

/**
 * The scene a builtin kind draws (phase 42.5): the scene contract in the metadata of its group's contribution (`WidgetKindGroup.sceneType` and the keys beside it), read from the
 * contribution's static record while the group is active for the tenant. Undefined for a kind that draws no scene, a group that is off, and a
 * state that cannot be read (nothing is then resolved or refused, as `blockedKindTypes` degrades).
 */
export async function builtinSceneContract(tenantId: string, type: string | undefined | null): Promise<SceneContract | undefined> {
  const group = type ? groupOfKind(type) : undefined
  if (!type || !group) return undefined
  try {
    const states = await ext.states(WIDGET_KINDS_POINT, tenantCtx(tenantId))
    const served = states.find((s) => s.state === 'active' && s.contribution.key === group)
    const metadata = served?.contribution.metadata
    // loaded here: ext-widget reads the module registry, which a caller that only asks which kinds are blocked need not load
    return metadata && metadata.sceneType === type ? (await import('./ext-widget')).sceneContractOf(metadata) : undefined
  } catch {
    return undefined
  }
}

/** The 422 a write names a kind the tenant may not use with. */
export function kindUnavailableError(type: string): AppError {
  return new AppError(`${MSG.WIDGET_KIND_UNAVAILABLE}: '${type}'`, 422, ErrorCode.VALIDATION_ERROR, { details: { type } })
}

/** 422 `WIDGET_KIND_UNAVAILABLE` when the kind is owned by a group that is not active for the tenant; nothing for other kinds. */
export async function assertKindAvailable(tenantId: string, type: string | undefined | null): Promise<void> {
  if (!type) return
  if ((await blockedKindTypes(tenantId)).has(type)) throw kindUnavailableError(type)
}

/** `rows` without the ones of a blocked kind. `kindOf` says which kind a row renders (undefined = not a builtin kind). */
export async function withoutBlockedKinds<T>(tenantId: string, rows: T[], kindOf: (row: T) => string | undefined): Promise<T[]> {
  if (rows.length === 0) return rows
  const blocked = await blockedKindTypes(tenantId)
  if (blocked.size === 0) return rows
  return rows.filter((row) => { const type = kindOf(row); return !type || !blocked.has(type) })
}
