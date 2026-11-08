import { collectReferences, type BoardPackage, type PackagePlacement } from './board-package'
import type { BoardBundle } from './board-package.bundle'
import { extSettingsForSave, invalidSettingFields, MAX_PLACEMENT_SETTINGS_BYTES, settingsByteSize } from './placement-settings'
import { kindForWidget, definitionDefaultsOf, tenantSettingsForSave } from './widget-settings'
import type { TenantMigrationStep } from './tenant-template'
import { CORE_BOARD, CORE_CARD, CORE_FORMAT } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/core'
import { prepareForSave } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/engine'
import { resolvePlacement } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/resolve'
import type { BuiltinKindSpec } from '@kuraykaraaslan-labs/common/server/widget-settings/kind'
import { allActionsOf, normalizeInstanceActions, RETIRED_ACTION_SOURCES, type NormalizedEntry } from './instance-actions'
import { parseStoredEntry } from './dashboard.dto'
import { missingPageInputs } from './board-pages'
import { splitSlotKey } from './slot-key'
import { isParamRef } from './board-window'
import { isEntityParam } from './board-params'
import { entryParamKeys, visibilityParamKeys, withoutRulesReadingUnknownParams } from './placement-references'
import { fitRect, normalizeGridCols, perPage, resolveOverlaps } from './grid-cols'
import { importTransform } from './transform.dto'

/** #17: the write path's own test (`instance.crud.service`): does this schema declare any field to prune against? */
const declaresFields = (schema: unknown) => !!schema && typeof schema === 'object' && !Array.isArray(schema) && Object.keys(schema).length > 0

/**
 * Planning a board import (phase 19.2 / 19.3): given a validated package and what the IMPORTING
 * tenant and caller can actually resolve, decide what would be created and what would be left out
 * or repaired. Pure and synchronous: every lookup (widgets, data sources, boards, commands) is
 * answered up front by the route and handed in as plain data, so the same plan drives the dry-run
 * report and the apply, and they can never disagree.
 *
 * Nothing here trusts the package: widgets are found again by kind and key in the importing tenant
 * (never created from the package), a binding or action that points at something this caller cannot
 * use is repaired (dropped, and reported) rather than imported, and each placement is later
 * written through the normal services, which re-check permissions, settings and slots.
 */
export interface ImportWidget {
  /** The local ref a placement is stored with (`manifest:..`, `ext:..`, `db:<uuid>`). */
  ref: string
  visibility: 'TENANT' | 'PRIVATE'
  schema?: unknown
  dataSpec?: Array<{ key: string; repeatable?: boolean }> | null
  /** Phase 21: a builtin (or a preset of one) imports its settings through its versioned template. */
  componentId?: string | null
  settingsTemplate?: { id: string; version: number } | null
  /** 21.8: a tenant-authored widget's template steps and its type (the `tenant:<type>` id). */
  settingsMigrations?: TenantMigrationStep[] | null
  type?: string
  /** #17: how the widget renders; an `iframe` one with no declared fields keeps its settings as given. */
  renderTier?: 'component' | 'template' | 'iframe'
  /** A preset's own settings layer. */
  defaultProps?: Record<string, unknown> | null
  baseWidgetRef?: string | null
}

export interface ImportEnv {
  /** Resolved widgets by `${kind}:${key}`; null or absent = the importing caller cannot place it here. */
  widgets: Map<string, ImportWidget | null>
  /** Data source keys discoverable for this tenant. */
  sources: Set<string>
  /**
   * Per data source, the queries THIS caller may run and the param keys each declares (19.3), from the
   * source's own `describe()`. Absent, or a source mapped to null (its `describe()` failed), means the
   * queries of that source are not checked here; the runner re-validates every query either way.
   */
  queries?: Map<string, Map<string, Set<string>> | null>
  /** Boards in this tenant the caller can open (what an `openBoard` may keep pointing at). */
  boards: Set<string>
  /**
   * Would this command action pass the authoring gate for this caller (exists, enabled, permitted, declared params)?
   * `sourceKey` is the source the entry is stored under, for the source's own rules (a symbol's command takes no
   * `{ $value }`, B5); absent for a command asked about without one (`resolveReferences`).
   */
  commandAllowed: (action: { commandKey: string; params?: Record<string, unknown> }, sourceKey?: string) => boolean
  /**
   * Why a command action would be refused (19.6), so the report can say which: `missing` (no
   * enabled module contributes that key here), `forbidden` (the caller lacks its permission),
   * `params` (it names a param the command does not declare, or one its source cannot supply). Absent = only `commandAllowed` is known.
   */
  commandStatus?: (action: { commandKey: string; params?: Record<string, unknown> }, sourceKey?: string) => CommandStatus
  /** Titles of the boards in `boards`, for the references list (optional). */
  boardTitles?: Map<string, string>
}

/**
 * A command key is a `dashboard:command` CONTRIBUTION key (a module manifest's `key`, the same in
 * every tenant), not a tenant-local id: a tenant only decides whether the contributing module is
 * enabled and who holds its permission. So an import never remaps one; it re-runs the authoring
 * gate and reports which of these applies. The `sourceKey` / `actionId` a run addresses
 * (`placementCommandRef`) are the package's own action-entry labels and travel unchanged.
 */
export type CommandStatus = 'ok' | 'missing' | 'forbidden' | 'params'

export type ImportIssueCode =
  | 'widget_missing'
  | 'widget_private_on_shared'
  | 'settings_dropped'
  /** Settings written by a newer template version than this app knows: never downgraded, so not imported. */
  | 'settings_newer'
  | 'slot_dropped'
  | 'source_unknown'
  /** The source exists but has no such query here, or the importing caller may not run it (19.3). */
  | 'query_unknown'
  | 'param_dropped'
  /** A card wider than the board's columns, or hanging off its right edge, was pulled inside (21.10). */
  | 'geometry_fitted'
  | 'board_unresolved'
  | 'command_unavailable'
  /** An `openPage` action opens a page the package's board does not carry (D-1 (a)). */
  | 'page_unresolved'
  /** An action entry or a stored rule reads a dashboard parameter the package's board does not define (phase 35, E9). */
  | 'param_unresolved'
  /** An `openPage` action would open its page with a required input unset: nothing sets it, the opener's page does not hold it, no board default. */
  | 'page_input_missing'
  /** An entry the placement write would refuse under its source's own rules (a symbol command reading the widget value, a `{ $row }` where no row is). */
  | 'action_invalid'
  /** A compute script over the placement's cap, or malformed: dropped, never repaired (35.5). */
  | 'transform_dropped'

export interface ImportIssue {
  /** The package placement key, or null for a board-level issue. */
  placement: string | null
  code: ImportIssueCode
  detail: string
  /** `skipped`: the placement is not imported; `repaired`: imported without the offending part. */
  outcome: 'skipped' | 'repaired'
}

export interface PlannedPlacement {
  key: string
  input: {
    widgetRef: string
    x: number; y: number; w: number; h: number; order: number
    title?: string | null
    refreshSeconds?: number | null
    settings: Record<string, unknown>
    dataBinding?: Record<string, unknown> | null
    actions?: unknown
    /** The in-board page (D-1 (a)); null = the main page. */
    pageKey?: string | null
    /** Shown only while this holds (phase 35); null = always. */
    visibility?: unknown
    /** The card's compute script (35.5), kept as text; null when the package carried none or it was dropped. */
    transform?: unknown
  }
}

export interface ImportPlan {
  board: BoardPackage['board']
  placements: PlannedPlacement[]
  issues: ImportIssue[]
  counts: { total: number; imported: number; skipped: number; repaired: number }
}

/** `${kind}:${key}` — how `ImportEnv.widgets` is keyed. */
export const widgetLookupKey = (w: PackagePlacement['widget']) => `${w.kind}:${w.key}`

/**
 * A placement's binding with what cannot work here removed (and reported): a slot the widget does
 * not declare, a data source this tenant does not have, a query that source does not offer this
 * caller, a param the query does not declare (the runner refuses unknown params outright), and a
 * `$param` reference to a dashboard parameter the package's board does not define. Null when nothing
 * is left.
 */
function repairBinding(
  placement: PackagePlacement,
  widget: ImportWidget,
  env: ImportEnv,
  boardParamKeys: Set<string>,
  issues: ImportIssue[],
  boardEntityKeys: Set<string> = new Set(),
  boardFilterKeys: Set<string> = new Set(),
): Record<string, unknown> | null {
  const binding = placement.dataBinding
  if (!binding || Object.keys(binding).length === 0) return null
  const declared = new Map((widget.dataSpec ?? []).map((s) => [s.key, s]))
  const out: Record<string, unknown> = {}
  for (const [slotKey, query] of Object.entries(binding)) {
    const { base, n } = splitSlotKey(slotKey)
    const slot = declared.get(base)
    if (!slot || (n > 1 && !slot.repeatable)) {
      issues.push({ placement: placement.key, code: 'slot_dropped', detail: `'${slotKey}' is not a slot of this widget here`, outcome: 'repaired' })
      continue
    }
    if (!env.sources.has(query.sourceKey)) {
      issues.push({ placement: placement.key, code: 'source_unknown', detail: `data source '${query.sourceKey}' is not available here (slot '${slotKey}')`, outcome: 'repaired' })
      continue
    }
    const offered = env.queries?.get(query.sourceKey)
    const declaredParams = offered ? offered.get(query.queryKey) : undefined
    if (offered && !declaredParams) {
      issues.push({ placement: placement.key, code: 'query_unknown', detail: `query '${query.queryKey}' of data source '${query.sourceKey}' is not available to you here (slot '${slotKey}')`, outcome: 'repaired' })
      continue
    }
    const params: Record<string, unknown> = {}
    for (const [paramKey, value] of Object.entries(query.params ?? {})) {
      if (declaredParams && !declaredParams.has(paramKey)) {
        issues.push({ placement: placement.key, code: 'param_dropped', detail: `'${paramKey}' is not a parameter of query '${query.queryKey}' here (slot '${slotKey}')`, outcome: 'repaired' })
        continue
      }
      if (isParamRef(value) && !boardParamKeys.has(value.$param)) {
        issues.push({ placement: placement.key, code: 'param_dropped', detail: `'${paramKey}' followed dashboard parameter '${value.$param}', which the board does not define`, outcome: 'repaired' })
        continue
      }
      // A filter narrows an entity parameter (phase 41; the package's `{ $alias }` were read as these): one on a value parameter,
      // or one the board does not define, is dropped and the parameter kept.
      if (isParamRef(value) && value.filter !== undefined && (!boardEntityKeys.has(value.$param) || !boardFilterKeys.has(value.filter))) {
        issues.push({ placement: placement.key, code: 'param_dropped', detail: `'${paramKey}' used filter '${value.filter}', which the board does not define`, outcome: 'repaired' })
        params[paramKey] = { $param: value.$param }
        continue
      }
      params[paramKey] = value
    }
    out[slotKey] = { ...query, params }
  }
  return Object.keys(out).length > 0 ? out : null
}

function repairActions(
  placement: PackagePlacement,
  env: ImportEnv,
  issues: ImportIssue[],
  pageKeys: Set<string> = new Set(),
  boardParamKeys: Set<string> = new Set(),
  board: { pages?: unknown; params?: unknown } = {},
): unknown {
  // A retired source (`nodeSelected`, phase 35 B7) fires nothing and no write accepts it: its entries are dropped and
  // reported (the reader below already leaves them out, so without this the file's object would be stored as it is).
  const storedSources = placement.actions && typeof placement.actions === 'object' && 'sources' in placement.actions
    ? Object.keys((placement.actions as { sources?: Record<string, unknown> }).sources ?? {}) : []
  const retired = storedSources.filter((k) => RETIRED_ACTION_SOURCES.includes(k))
  for (const sourceKey of retired) {
    issues.push({ placement: placement.key, code: 'action_invalid', detail: `'${sourceKey}' is a trigger no widget fires any more; its entries were dropped`, outcome: 'repaired' })
  }
  const normalized = normalizeInstanceActions(placement.actions)
  if (!normalized) return retired.length > 0 ? null : placement.actions ?? null
  let removed = retired.length > 0
  // An entry the write rules complete (a symbol command's default confirmation): the stored shape then differs from the file's.
  let completed = false
  const sources: Record<string, NormalizedEntry[]> = {}
  for (const [sourceKey, entries] of Object.entries(normalized.sources)) {
    const kept: NormalizedEntry[] = []
    for (const e of entries) {
      const a = e.action as { kind: string; boardId?: string; commandKey?: string; params?: Record<string, unknown> }
      if (a.kind === 'openBoard' && !env.boards.has(String(a.boardId).toLowerCase())) {
        issues.push({ placement: placement.key, code: 'board_unresolved', detail: `'${sourceKey}' opens a board that does not exist here`, outcome: 'repaired' })
        removed = true
        continue
      }
      const page = (e.action as { page?: unknown }).page
      if (a.kind === 'openPage' && typeof page === 'string' && !pageKeys.has(page)) {
        issues.push({ placement: placement.key, code: 'page_unresolved', detail: `'${sourceKey}' opens a page '${page}' this dashboard does not have`, outcome: 'repaired' })
        removed = true
        continue
      }
      // A page opened with a required input nobody fills: the placement write refuses it (422), and the apply runs through
      // that same write, so the plan drops the entry here and says so, rather than let the dry run promise what the apply
      // would refuse (phase 35 review, F3).
      if (a.kind === 'openPage' && typeof page === 'string') {
        const missing = missingPageInputs(e.action as { page?: string | null; set?: Record<string, unknown> }, board.pages, board.params, placement.pageKey ?? null)
        if (missing.length > 0) {
          issues.push({ placement: placement.key, code: 'page_input_missing', detail: `'${sourceKey}' opens page '${page}' without its required input(s) '${missing.join("', '")}'`, outcome: 'repaired' })
          removed = true
          continue
        }
      }
      // E9: an entry that names a parameter the board does not define (a set key, a `{ $param }`, a condition, a token)
      // would be refused by a placement write; here it is dropped and reported, like a page the board does not have.
      const unknownParams = [...entryParamKeys(e)].filter((k) => !boardParamKeys.has(k)).sort()
      if (unknownParams.length > 0) {
        issues.push({ placement: placement.key, code: 'param_unresolved', detail: `'${sourceKey}' refers to dashboard parameter(s) '${unknownParams.join("', '")}', which the board does not define`, outcome: 'repaired' })
        removed = true
        continue
      }
      if (a.kind === 'command' && !env.commandAllowed({ commandKey: String(a.commandKey), params: a.params }, sourceKey)) {
        const status = env.commandStatus?.({ commandKey: String(a.commandKey), params: a.params }, sourceKey)
        issues.push({ placement: placement.key, code: 'command_unavailable', detail: commandDetail(String(a.commandKey), status), outcome: 'repaired' })
        removed = true
        continue
      }
      // Last, the write rules of the entry's own source (the package parsed the shape only, F2): what they refuse is
      // dropped and reported, what they complete is stored as the write would store it.
      const strict = parseStoredEntry(sourceKey, e)
      if (!strict) {
        issues.push({ placement: placement.key, code: 'action_invalid', detail: `'${sourceKey}' holds an entry ('${e.id}') this dashboard would not accept there and it was dropped`, outcome: 'repaired' })
        removed = true
        continue
      }
      if (strict.confirm !== e.confirm) completed = true
      kept.push(strict as NormalizedEntry)
    }
    if (kept.length > 0) sources[sourceKey] = kept
  }
  if (!removed && !completed) return placement.actions ?? null
  return Object.keys(sources).length > 0 ? { v: 2, sources } : null
}

/**
 * E9 for the card's visibility rule (phase 35): a rule reading a parameter the board does not define would be refused
 * by the placement write; the plan drops the rule (the card is then always shown) and says so, like an entry that does.
 */
function repairVisibility(placement: PackagePlacement, issues: ImportIssue[], boardParamKeys: Set<string>): unknown {
  if (!placement.visibility) return null
  const unknown = [...visibilityParamKeys(placement.visibility)].filter((k) => !boardParamKeys.has(k)).sort()
  if (unknown.length === 0) return placement.visibility
  issues.push({ placement: placement.key, code: 'param_unresolved', detail: `the card's visibility rule reads dashboard parameter(s) '${unknown.join("', '")}', which the board does not define, and was dropped`, outcome: 'repaired' })
  return null
}

function commandDetail(key: string, status: CommandStatus | undefined): string {
  if (status === 'missing') return `command '${key}' does not exist here (no enabled module provides it)`
  if (status === 'forbidden') return `command '${key}' exists here but you may not run it`
  if (status === 'params') return `command '${key}' here does not take the params this action sets`
  return `command '${key}' is not available to you here`
}

export function planBoardImport(pkg: BoardPackage, env: ImportEnv, targetScope: 'TENANT' | 'PRIVATE'): ImportPlan {
  const issues: ImportIssue[] = []
  const placements: PlannedPlacement[] = []
  const boardParamKeys = new Set((pkg.board.params ?? []).map((p) => p.key))
  const boardEntityKeys = new Set((pkg.board.params ?? []).filter(isEntityParam).map((p) => p.key))
  const boardFilterKeys = new Set((pkg.board.filters ?? []).map((f) => f.key))
  const pageKeys = new Set((pkg.board.pages ?? []).map((p) => p.key))
  // The new board takes the package's columns; geometry is kept as made on them, only fitted inside.
  const cols = normalizeGridCols(pkg.board.gridCols)

  for (const p of pkg.placements) {
    const widget = env.widgets.get(widgetLookupKey(p.widget)) ?? null
    if (!widget) {
      issues.push({ placement: p.key, code: 'widget_missing', detail: `${p.widget.kind} widget '${p.widget.key}' is not available here`, outcome: 'skipped' })
      continue
    }
    if (targetScope === 'TENANT' && widget.visibility === 'PRIVATE') {
      issues.push({ placement: p.key, code: 'widget_private_on_shared', detail: `'${p.widget.key}' is private and cannot go on a shared board`, outcome: 'skipped' })
      continue
    }
    let settings = p.settings ?? {}
    const kind = kindForWidget(widget)
    if (kind) {
      // Phase 21: migrated to this app's templates, validated deeply, pruned and stamped; a bad part is
      // dropped (repaired), a part from a newer template version skips the placement (never downgraded).
      const res = prepareTemplatedSettings(kind, settings, definitionDefaultsOf(widget))
      if (res.newer.length) {
        issues.push({ placement: p.key, code: 'settings_newer', detail: `settings were saved by a newer widget version (${res.newer.map((n) => `${n.id} v${n.stored}, this app knows v${n.known}`).join('; ')})`, outcome: 'skipped' })
        continue
      }
      if (res.issues.length) {
        issues.push({ placement: p.key, code: 'settings_dropped', detail: `settings this app does not accept were dropped: ${res.issues.slice(0, 6).map((i) => i.path).join(', ')}`, outcome: 'repaired' })
      }
      settings = res.settings
    } else if (widget.ref.startsWith('db:') && widget.renderTier === 'iframe' && !declaresFields(widget.schema)) {
      // #17: an iframe-tier card with no schema has nothing to prune against; the write path keeps its settings as
      // given (`settingsForWidget`), so the import does too (the size cap below still applies).
    } else if (widget.ref.startsWith('db:')) {
      // 21.8: a tenant-authored card migrates up to this tenant's published template of the widget;
      // settings from a newer version than it knows skip the placement, like a builtin's. 7d: then the same
      // engine check and prune the write path runs (`createMany` re-runs it strictly); a refused value is
      // dropped and reported. A package card is a `copy` of a stored one, so a choice whose option was removed
      // without a step is filtered out of its list (7e), not the whole list dropped, and a deprecated field's
      // value travels with it (7c).
      const res = tenantSettingsForSave({
        type: widget.type ?? p.widget.key, schema: widget.schema as object | null, defaultProps: widget.defaultProps,
        settingsTemplate: widget.settingsTemplate, settingsMigrations: widget.settingsMigrations,
      }, settings, { unstamped: 1, copy: true })
      if (res.newer) {
        issues.push({ placement: p.key, code: 'settings_newer', detail: `settings were saved by a newer widget version (${res.newer.id} v${res.newer.stored}, this app knows v${res.newer.known})`, outcome: 'skipped' })
        continue
      }
      const dropped = [...res.issues, ...res.repaired]
      if (dropped.length) {
        issues.push({ placement: p.key, code: 'settings_dropped', detail: `settings the widget does not accept here were dropped: ${dropped.slice(0, 6).map((i) => i.path).join(', ')}`, outcome: 'repaired' })
      }
      settings = res.settings
    } else if (widget.ref.startsWith('ext:')) {
      // #17: the write path's own check and prune (a key the contribution's schema does not declare is dropped
      // silently, as the engine drops one for a builtin); a refused value is dropped and reported, not refused.
      const res = extSettingsForSave(widget.schema, settings)
      if (res.invalid.length > 0) {
        issues.push({ placement: p.key, code: 'settings_dropped', detail: `settings the widget does not accept here were dropped: ${res.invalid.join(', ')}`, outcome: 'repaired' })
      }
      settings = res.settings
    } else {
      const bad = widget.schema ? invalidSettingFields(widget.schema, settings) : []
      if (bad.length > 0) {
        settings = Object.fromEntries(Object.entries(settings).filter(([k]) => !bad.includes(k)))
        issues.push({ placement: p.key, code: 'settings_dropped', detail: `settings the widget does not accept here were dropped: ${bad.join(', ')}`, outcome: 'repaired' })
      }
    }
    // #17: settings still over the size cap after the prune would be refused by the write path (422); the import
    // repairs instead: the card is placed with its widget's defaults, and the report says why.
    const bytes = settingsByteSize(settings)
    if (bytes > MAX_PLACEMENT_SETTINGS_BYTES) {
      issues.push({ placement: p.key, code: 'settings_dropped', detail: `the card's settings (${bytes} bytes) are over the ${MAX_PLACEMENT_SETTINGS_BYTES}-byte limit and were dropped`, outcome: 'repaired' })
      settings = {}
    }
    // E9: a stored rule (a process diagram's) reading a parameter the board does not define is dropped and reported,
    // like an action entry that does; the write path would refuse the whole card for it.
    const rules = withoutRulesReadingUnknownParams(settings, pkg.board.params ?? [])
    if (rules.dropped.length > 0) {
      issues.push({ placement: p.key, code: 'param_unresolved', detail: `rule(s) reading dashboard parameter(s) '${rules.dropped.join("', '")}', which the board does not define, were dropped`, outcome: 'repaired' })
      settings = rules.settings
    }
    const fitted = fitRect({ id: p.key, x: p.x, y: p.y, w: p.w, h: p.h }, cols)
    if (fitted.x !== p.x || fitted.w !== p.w) {
      issues.push({ placement: p.key, code: 'geometry_fitted', detail: `the card did not fit ${cols} columns (column ${p.x + 1}, width ${p.w}) and was moved inside`, outcome: 'repaired' })
    }
    // 35.5: a compute script travels as text and is never repaired; one over the placement's cap is dropped and reported.
    const transform = importTransform(p.transform)
    if (transform.problem) issues.push({ placement: p.key, code: 'transform_dropped', detail: transform.problem, outcome: 'repaired' })
    placements.push({
      key: p.key,
      input: {
        widgetRef: widget.ref,
        x: fitted.x, y: p.y, w: fitted.w, h: p.h, order: p.order,
        title: p.title ?? null,
        refreshSeconds: p.refreshSeconds ?? null,
        pageKey: p.pageKey ?? null,
        settings,
        dataBinding: repairBinding(p, widget, env, boardParamKeys, issues, boardEntityKeys, boardFilterKeys),
        actions: repairActions(p, env, issues, pageKeys, boardParamKeys, pkg.board),
        visibility: repairVisibility(p, issues, boardParamKeys),
        transform: transform.transform,
      },
    })
  }

  // Cards fitted into the grid one by one may now share cells (two cards past the right edge both land on the
  // last columns): push them down like a column rescale does, and say so for every card that moved.
  // Per in-board page: cards on different pages never share cells (D-1 (a)).
  const rects = placements.map((pl) => ({ id: pl.key, x: pl.input.x, y: pl.input.y, w: pl.input.w, h: pl.input.h, pageKey: pl.input.pageKey ?? null }))
  const resolved = new Map(perPage(rects, (r) => r.pageKey, resolveOverlaps).map((r) => [r.id, r]))
  for (const pl of placements) {
    const r = resolved.get(pl.key)!
    if (r.y === pl.input.y) continue
    if (!issues.some((i) => i.placement === pl.key && i.code === 'geometry_fitted')) {
      issues.push({ placement: pl.key, code: 'geometry_fitted', detail: `the card overlapped another one and was moved down (row ${pl.input.y + 1} to ${r.y + 1})`, outcome: 'repaired' })
    }
    pl.input.y = r.y
  }

  const skipped = new Set(issues.filter((i) => i.outcome === 'skipped').map((i) => i.placement))
  const repaired = new Set(issues.filter((i) => i.outcome === 'repaired').map((i) => i.placement))
  // The board's own look (`core:board`): repaired like a placement's; newer than this app = not imported.
  let boardSettings: Record<string, unknown> | null = null
  if (pkg.board.settings) {
    const res = prepareForSave(pkg.board.settings, { type: CORE_BOARD })
    if (res.newer.length) {
      issues.push({ placement: null, code: 'settings_newer', detail: `the dashboard's own settings were saved by a newer version (${res.newer.map((n) => `${n.id} v${n.stored}`).join('; ')}) and were left out`, outcome: 'repaired' })
    } else {
      if (res.issues.length) issues.push({ placement: null, code: 'settings_dropped', detail: `dashboard settings this app does not accept were dropped: ${res.issues.slice(0, 6).map((i) => i.path).join(', ')}`, outcome: 'repaired' })
      boardSettings = Object.keys(res.settings).some((k) => k !== '$v') ? res.settings : null
    }
  }

  return {
    board: { ...pkg.board, settings: boardSettings },
    placements,
    issues,
    counts: { total: pkg.placements.length, imported: placements.length, skipped: skipped.size, repaired: repaired.size },
  }
}

/** A placement's settings through its builtin template, without throwing (the planner reports instead). */
function prepareTemplatedSettings(kind: BuiltinKindSpec, settings: Record<string, unknown>, definitionDefaults: Record<string, unknown> | null) {
  const t = kind.template
  const layers = resolvePlacement({ template: t, slotCount: kind.slots.length, settings: null, board: null, definitionDefaults }).layers
  return prepareForSave(settings, { type: t, card: CORE_CARD, format: t.format ? CORE_FORMAT : undefined }, { defaults: layers })
}

// ── Bundles (phase 19.6) ────────────────────────────────────────────────────────────────────────

export interface BundleBoardPlan {
  /** The bundle-local ref (`boards[i].ref`). */
  ref: string
  /** The board the export started from (`boards[0]`); a title override applies to it only. */
  root: boolean
  plan: ImportPlan
}

export interface BundlePlan {
  boards: BundleBoardPlan[]
  /** Summed over every member. */
  counts: ImportPlan['counts']
  /** Every member's issues, each with the member it belongs to. */
  issues: Array<ImportIssue & { board: string }>
}

/**
 * Plan a whole bundle against one environment: each member exactly as a single package, except that
 * an `openBoard` to another member is kept (its target will exist: every member is created before any
 * placement), still written as the member's ref; the apply rewrites it to the new id. A target
 * outside the bundle is resolved as in a single import. Pure.
 */
export function planBundleImport(bundle: BoardBundle, env: ImportEnv, targetScope: 'TENANT' | 'PRIVATE'): BundlePlan {
  const refs = bundle.boards.map((m) => m.ref)
  const memberEnv: ImportEnv = { ...env, boards: new Set([...env.boards, ...refs]) }
  const boards = bundle.boards.map((m, i) => ({ ref: m.ref, root: i === 0, plan: planBoardImport(m.package, memberEnv, targetScope) }))
  const counts = { total: 0, imported: 0, skipped: 0, repaired: 0 }
  for (const b of boards) for (const k of Object.keys(counts) as Array<keyof typeof counts>) counts[k] += b.plan.counts[k]
  return { boards, counts, issues: boards.flatMap((b) => b.plan.issues.map((i) => ({ ...i, board: b.ref }))) }
}

/** What the dialog lists (19.6): every board, data source and command the package points at, resolved for this caller. */
export interface ResolvedReferences {
  /** `bundle`: another board of the same bundle; `here`: a board this caller can open here; `missing`: dropped on import. */
  boards: Array<{ id: string; status: 'bundle' | 'here' | 'missing'; title?: string }>
  sources: Array<{ key: string; available: boolean }>
  /** `ok` only when every action with that key passes the authoring gate. */
  commands: Array<{ key: string; status: CommandStatus }>
}

/**
 * Resolve what the packages point at, read off their placements (not their `references` field,
 * which is only a hint a file could get wrong). `bundleTitles` maps the refs of a bundle's members to
 * their titles. Pure.
 */
export function resolveReferences(
  packages: BoardPackage[],
  env: ImportEnv,
  bundleTitles: Map<string, string> = new Map(),
): ResolvedReferences {
  const placements = packages.flatMap((p) => p.placements)
  const refs = collectReferences(placements)
  const boards = refs.boards.map((id) => {
    if (bundleTitles.has(id)) return { id, status: 'bundle' as const, title: bundleTitles.get(id) }
    if (env.boards.has(id)) return { id, status: 'here' as const, ...(env.boardTitles?.has(id) ? { title: env.boardTitles.get(id) } : {}) }
    return { id, status: 'missing' as const }
  })
  const commandActions = new Map<string, Array<{ commandKey: string; params?: Record<string, unknown> }>>()
  for (const p of placements) {
    for (const a of allActionsOf(p.actions)) {
      if (a.kind !== 'command' || typeof a.commandKey !== 'string' || !a.commandKey) continue
      const list = commandActions.get(a.commandKey) ?? []
      list.push({ commandKey: a.commandKey, params: a.params })
      commandActions.set(a.commandKey, list)
    }
  }
  const commands = refs.commands.map((key) => {
    let status: CommandStatus = 'ok'
    for (const a of commandActions.get(key) ?? [{ commandKey: key }]) {
      if (env.commandAllowed(a)) continue
      status = env.commandStatus?.(a) ?? 'forbidden'
      if (status === 'ok') status = 'forbidden'
      break
    }
    return { key, status }
  })
  return { boards, sources: refs.sources.map((key) => ({ key, available: env.sources.has(key) })), commands }
}
