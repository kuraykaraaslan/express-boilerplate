import { builtinKind } from '@kuraykaraaslan-labs/common/server/widget-settings/templates/index'
import { CORE_CARD, CORE_FORMAT } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/core'
import { prepareForSave, prune, readNamespace, readStamp, validate } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/engine'
import { resolvePlacement } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/resolve'
import type { BuiltinKindSpec } from '@kuraykaraaslan-labs/common/server/widget-settings/kind'
import type { Issue, SettingsTemplate, Sparse } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/types'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { builtinTypeOfComponent } from './builtin-component-files'
import { migrateTenantSettings, storedTenantVersion, TENANT_TEMPLATE_PREFIX, tenantTemplate, type TenantTemplateSource } from './tenant-template'
import MSG from './dashboard.messages'
import { withDeclaredNamespaces } from './placement-settings'

/**
 * Phase 21: placement settings are versioned templates (D-21.6). A builtin widget, and a preset
 * saved from one ("Save as widget"), is validated and migrated with its type's template from CODE
 * (kui-react WidgetKit, vendored), never with the `schema` copy on its row: the row lags a deploy and
 * a preset copied it once. A tenant-authored widget follows its own `tenant:<type>` template (21.8,
 * `tenant-template.ts`): migrated, validated by the engine, pruned against its `defaultProps` and stamped
 * here (7d).
 * Contributed widgets are checked against their contribution's schema and pruned to it (`extSettingsForSave`,
 * owner decision 2026-10-18 #17) until they get templates of their own (21.7).
 */

/** The fields of a widget row this needs. */
export interface TemplatedWidget {
  type?: string | null
  componentId?: string | null
  settingsTemplate?: { id: string; version: number } | null
  defaultProps?: object | null
  /** Set on a preset ("Save as widget"): its `defaultProps` are a settings layer of their own. */
  baseWidgetRef?: string | null
}

/** A preset's saved settings sit between the type's defaults and the placement; a builtin row has none. */
export const definitionDefaultsOf = (widget: TemplatedWidget): Record<string, unknown> | null =>
  widget.baseWidgetRef ? ((widget.defaultProps as Record<string, unknown> | null | undefined) ?? null) : null

/** The builtin kind a widget row renders with, if any. */
export function kindForWidget(widget: TemplatedWidget | null | undefined): BuiltinKindSpec | undefined {
  if (!widget) return undefined
  const id = widget.settingsTemplate?.id
  if (id?.startsWith('builtin:')) return builtinKind(id.slice('builtin:'.length))
  const type = builtinTypeOfComponent(widget.componentId)
  return type ? builtinKind(type) : undefined
}

/** Where a settings path points, for a message an admin can act on. */
const describe = (issues: Issue[]) => issues.slice(0, 8).map((i) => `${i.path} (${i.message})`).join('; ')

/** At most this many issues travel in a 422's `details.issues`. */
export const MAX_WIRE_ISSUES = 50
const cap = (s: unknown, n: number) => (typeof s === 'string' ? s.slice(0, n) : undefined)

/**
 * The engine's issues as a 422 sends them (`details.issues`): path, the English message, and the
 * `code` + `params` the settings editor words in the viewer's language (decision 2026-10-17 #6). The
 * error's own message stays English for logs and API callers. Texts are capped: an option is the
 * caller's own value echoed back.
 */
export function wireIssues(issues: Issue[]): Issue[] {
  return issues.slice(0, MAX_WIRE_ISSUES).map((i) => {
    const out: Issue = { path: cap(i.path, 300) ?? '', message: cap(i.message, 500) ?? '' }
    if (i.code) out.code = i.code
    if (i.params) {
      const p: NonNullable<Issue['params']> = {}
      const label = cap(i.params.label, 200)
      const option = cap(i.params.option, 120)
      if (label !== undefined) p.label = label
      if (typeof i.params.min === 'number') p.min = i.params.min
      if (typeof i.params.max === 'number') p.max = i.params.max
      if (option !== undefined) p.option = option
      out.params = p
    }
    return out
  })
}

/** The 422 for settings the engine refused: an English message with the first paths, and every issue in `details`. */
export function settingsInvalidError(issues: Issue[]): AppError {
  return new AppError(`${MSG.SETTINGS_INVALID}: ${describe(issues)}`, 422, ErrorCode.VALIDATION_ERROR, { details: { issues: wireIssues(issues) } })
}

/**
 * The stored form of a placement's settings: migrated to the current templates, validated deeply
 * (repeater items, colours, fonts, options, lengths, cross-field rules), pruned to what differs from
 * the defaults under the placement, and stamped `$v` by the server. Refuses settings written by a newer
 * template version (409, never downgraded) and invalid values (422, with their full paths).
 */
export function prepareSettings(
  kind: BuiltinKindSpec,
  incoming: Record<string, unknown> | null | undefined,
  opts: { previous?: Record<string, unknown> | null; definitionDefaults?: Record<string, unknown> | null } = {},
): Record<string, unknown> {
  const template = kind.template
  const set = { type: template, card: CORE_CARD, format: template.format ? CORE_FORMAT : undefined }
  // The layers under the placement, WITHOUT the board's card defaults: a value the admin set on the card
  // stays set even if the board's defaults change later.
  const layers = resolvePlacement({
    template, slotCount: kind.slots.length, settings: null, board: null, definitionDefaults: opts.definitionDefaults ?? null,
  }).layers
  const res = prepareForSave(incoming ?? {}, set, { defaults: layers, previous: opts.previous ?? null })
  if (res.newer.length) {
    throw new AppError(
      `${MSG.SETTINGS_FROM_NEWER_VERSION}: ${res.newer.map((n) => `${n.id} v${n.stored} (this server knows v${n.known})`).join(', ')}`,
      409, ErrorCode.CONFLICT,
    )
  }
  if (res.issues.length) {
    throw settingsInvalidError(res.issues)
  }
  return res.settings
}

/** True when a stored settings object carries a stamp newer than this code (render read-only). */
export function hasNewerSettings(kind: BuiltinKindSpec, stored: Sparse | null | undefined): boolean {
  const stamp = readStamp(stored)
  const known: Record<string, number> = { [kind.template.id]: kind.template.version, [CORE_CARD.id]: CORE_CARD.version, [CORE_FORMAT.id]: CORE_FORMAT.version }
  return Object.entries(stamp).some(([id, v]) => known[id] !== undefined && (v as number) > known[id])
}

/** A type template with no fields: lets the engine handle only the common card of a non-builtin widget. */
const NO_TYPE_FIELDS = { id: 'x:none', version: 1, namespace: '$x:none', label: '', groups: [], fields: {}, migrations: [] } as const

/**
 * A non-builtin widget (module manifest, `ext:`, tenant template) gets the common card too (phase 21):
 * its `$card` part is migrated, validated, pruned and stamped through `core:card`; its own keys are left
 * to the caller's existing check. Refuses `$card` from a newer version (409) and invalid values (422).
 */
export function prepareCardSettings(
  incoming: Record<string, unknown>,
  previous?: Record<string, unknown> | null,
): Record<string, unknown> {
  const card = incoming.$card
  const stamp = (incoming.$v ?? {}) as Record<string, unknown>
  const res = prepareForSave(
    { ...(card !== undefined ? { $card: card } : {}), $v: { 'core:card': stamp['core:card'] } },
    { type: NO_TYPE_FIELDS as never, card: CORE_CARD },
    { previous: previous ? { $v: { 'core:card': (previous.$v as Record<string, unknown> | undefined)?.['core:card'] } } : null },
  )
  if (res.newer.length) {
    throw new AppError(`${MSG.SETTINGS_FROM_NEWER_VERSION}: core:card v${res.newer[0].stored} (this server knows v${res.newer[0].known})`, 409, ErrorCode.CONFLICT)
  }
  if (res.issues.length) {
    throw settingsInvalidError(res.issues)
  }
  const { $card: _old, $v: oldStamp, ...rest } = incoming
  void _old
  const out: Record<string, unknown> = { ...rest }
  if (res.settings.$card) out.$card = res.settings.$card
  out.$v = { ...((oldStamp as Record<string, unknown> | undefined) ?? {}), 'core:card': CORE_CARD.version }
  return out
}

const newerError = (id: string, stored: number, known: number) =>
  new AppError(`${MSG.SETTINGS_FROM_NEWER_VERSION}: ${id} v${stored} (this server knows v${known})`, 409, ErrorCode.CONFLICT)

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** True when a settings object carries a `tenant:` stamp: only the server writes one, on a stored card. */
const hasTenantStamp = (s: Sparse) => Object.keys(readStamp(s)).some((id) => id.startsWith(TENANT_TEMPLATE_PREFIX))

/**
 * 7e: a multi-select choice the card already held (`held`) whose option is no longer listed. Before `filterList`
 * a removed option made no step, so such cards exist, and `validate` would refuse every save of one (422) or drop
 * the whole list on import. Taken out the way `filterList` would (a list left empty is unset); a choice the card
 * never held is left for `validate` to refuse.
 */
function withoutRemovedChoices(template: SettingsTemplate, values: Sparse, held: Sparse): Sparse {
  for (const [k, f] of Object.entries(template.fields)) {
    const list = values[k]
    const before = held[k]
    if (f.type !== 'multi-select' || !Array.isArray(list) || !Array.isArray(before)) continue
    const allowed = (f.options ?? []).map((o) => (typeof o === 'string' ? o : o.value))
    // An empty option list is loaded at runtime: nothing can be said about what was removed.
    const gone = new Set(allowed.length ? before.filter((x) => typeof x === 'string' && !allowed.includes(x)) : [])
    if (!gone.size) continue
    const kept = list.filter((x) => !gone.has(x))
    if (kept.length) values[k] = kept
    else delete values[k]
  }
  return values
}

export interface TenantSaveResult {
  /** The settings to store: own keys validated and pruned, then the `$` namespaces, `$v` last. */
  settings: Record<string, unknown>
  /** Values the engine refused (already dropped from `settings`), with their paths. */
  issues: Issue[]
  /**
   * Deprecated values a copy carried that the engine refuses (already dropped): reported by the import, never a
   * 422 on the write path (a copy of a card must save).
   */
  repaired: Issue[]
  /** Set when the incoming or the stored object is newer than the template; `settings` is then the incoming. */
  newer?: { id: string; stored: number; known: number }
}

/**
 * The pure core of a tenant-authored widget's settings write (21.8, 7d), shared by the placement write
 * path (`prepareTenantSettings`, strict) and the board-package import planner (repairing), so whatever the
 * planner hands to `createMany` passes the strict path unchanged. Against the PUBLISHED definition: the own
 * keys are migrated from the version they were written at, validated by the engine (unknown keys and
 * `null` dropped, lengths, colours, icons, options, repeater items checked), and pruned against the
 * definition's `defaultProps` only: the renderer never falls back to a field's `value`, so a value equal to
 * it is a real choice and is kept. `$card` and its stamp are the caller's (`prepareCardSettings`).
 *
 * A field the published schema marks deprecated (7c) is read-only: an update ignores whatever was sent and
 * keeps the stored value (migrated), never validated (a legacy value the stricter checks would refuse must not
 * make the card unsaveable). A create that is a `copy` of a stored card carries the value along, so a duplicate,
 * an undo or a package round trip keeps it; it came from outside, so it is checked, and one the engine refuses
 * is left out and reported in `repaired`. Any other create is fresh and the key is left out.
 *
 * A multi-select choice the card already held whose option was removed without a step is taken out
 * (`withoutRemovedChoices`), not refused. What the card held: the stored row on an update; on a `copy` of a
 * stored card (a duplicate, the undo of a remove, a package import) the copy itself. By default a create is a
 * copy when it carries a `tenant:` stamp (only the server stamps, and the board sends copies stamped).
 *
 * `unstamped` is the version an object without a `tenant:` stamp is at (see `migrateTenantSettings`); by
 * default a new card is at the current version and an update continues from the stored row's.
 */
export function tenantSettingsForSave(
  widget: TenantTemplateSource,
  incoming: Record<string, unknown>,
  opts: { previous?: Record<string, unknown> | null; unstamped?: number; copy?: boolean } = {},
): TenantSaveResult {
  const template = tenantTemplate(widget)
  const previous = opts.previous ?? null
  const prev = previous ? storedTenantVersion(previous, template) : 1
  if (prev > template.version) return { settings: incoming, issues: [], repaired: [], newer: { id: template.id, stored: prev, known: template.version } }
  const res = migrateTenantSettings(template, incoming, opts.unstamped ?? (previous ? prev : template.version))
  if (res.newer) return { settings: incoming, issues: [], repaired: [], newer: res.newer }
  const migrated = readNamespace(res.settings, template)
  const copy = !previous && (opts.copy ?? hasTenantStamp(incoming))
  const held = previous ? readNamespace(migrateTenantSettings(template, previous).settings, template) : copy ? migrated : {}
  const deprecated = Object.keys(template.fields).filter((k) => template.fields[k].deprecated)
  const active = withoutRemovedChoices(template, { ...migrated }, held)
  let kept: Record<string, unknown> = {}
  let repaired: Issue[] = []
  if (deprecated.length && previous) {
    for (const k of deprecated) if (held[k] !== undefined) kept[k] = held[k]
  } else if (deprecated.length && copy) {
    const carried = validate(template, Object.fromEntries(deprecated.filter((k) => active[k] !== undefined).map((k) => [k, active[k]])))
    kept = carried.values
    repaired = carried.issues
  }
  for (const k of deprecated) delete active[k]
  const checked = validate(template, active)
  const own = { ...prune(checked.values, isObj(widget.defaultProps) ? widget.defaultProps : {}), ...kept }
  // Own keys in the order they came (`validate` returns schema order), a kept deprecated value the request
  // left out after them, then the namespaces, `$v` last (the order `migrateTenantSettings` writes): a second
  // pass writes the same bytes, which a package round trip compares.
  const settings: Record<string, unknown> = {}
  for (const k of Object.keys(migrated)) if (k in own) settings[k] = own[k]
  for (const k of Object.keys(kept)) if (!(k in settings)) settings[k] = kept[k]
  // #17: only the namespaces such a card declares (`$card`, `$v` with its own stamps); any other `$` key is pruned.
  for (const [k, v] of Object.entries(withDeclaredNamespaces(res.settings, (id) => id === template.id))) if (k.startsWith('$')) settings[k] = v
  return { settings, issues: checked.issues, repaired }
}

/**
 * A tenant-authored widget's placement settings (21.8), strict: `tenantSettingsForSave`, refusing settings
 * written by a newer template version, or replacing stored ones that were (409, never downgraded), and any
 * value the engine refuses (422, with its path, the same message as a builtin's).
 */
export function prepareTenantSettings(
  widget: TenantTemplateSource,
  incoming: Record<string, unknown>,
  previous?: Record<string, unknown> | null,
): Record<string, unknown> {
  const res = tenantSettingsForSave(widget, incoming, { previous })
  if (res.newer) throw newerError(res.newer.id, res.newer.stored, res.newer.known)
  if (res.issues.length) throw settingsInvalidError(res.issues)
  return res.settings
}
