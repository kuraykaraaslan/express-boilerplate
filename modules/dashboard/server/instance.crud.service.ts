import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { In, type QueryRunner } from 'typeorm'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import type { BuiltinKindSpec } from '@kuraykaraaslan-labs/common/server/widget-settings/kind'
import { findRootPublishedWidget } from './widget.root-catalog'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import { DashboardCardOverlay } from './entities/dashboard_card_overlay.entity'
import { DashboardWidget } from './entities/dashboard_widget.entity'
import { DashboardBoard } from './entities/dashboard_board.entity'
import { fitsGrid, normalizeGridCols } from './grid-cols'
import { assertActionPagesOnBoard, assertActionPageInputs, assertPageOnBoard } from './board-pages'
import { actionUsesRow, conditionUsesRow, type CreateInstanceInput, type UpdateInstanceInput, type SaveLayoutInput, type SurfaceRef } from './dashboard.dto'
import MSG from './dashboard.messages'
import { assertSettingsSize, extSettingsForSave, extSettingsInvalidError } from './placement-settings'
import { embedHostIssue, embedHostRefusedError } from './embed-hosts'
import { definitionDefaultsOf, kindForWidget, prepareCardSettings, prepareSettings, prepareTenantSettings } from './widget-settings'
import { DashboardWidgetVersion } from './entities/dashboard_widget_version.entity'
import { applyPinnedSnapshot, applyPublishedSnapshot } from './widget-snapshot'

import { splitSlotKey } from './slot-key'
import { normalizeCondition, normalizeInstanceActions, type EntryCondition } from './instance-actions'
import { assertElementCommands, assertSettingsKeepElementCommands, type ElementAuthoring } from './element-actions.registry'
import { assertKindAvailable, builtinSceneContract, kindTypeOf } from './widget-kind-groups'
import { assertPlacementGuards, effectiveKindSettings, hasPlacementGuards, isGuardedType } from './placement-guard'
import { assertPlacementParamRefsKnown } from './placement-references'
import { assertWidgetPlaceable } from './widget-placement.acl'
import { assertPlacementEntityRefs, boardAliasKeys, normalizeBoardRow, normalizeParamRefs, type BoardParam } from './board-params'
import { markSurfaceChanged } from './board-snapshot'

/**
 * A card's visibility rule in the one stored shape (phase 35): the DTO already normalises a parsed body, but a caller
 * that hands the service an unparsed one (an internal copy, a test) must not store the 16.6 `{ param }` shape either.
 * Idempotent on a normalised rule.
 */
function storedVisibility(v: { when?: unknown } | null | undefined): { when: EntryCondition } | null {
  if (!v) return null
  const when = normalizeCondition(v.when)
  // A rule the reader cannot judge is refused, never stored as "no rule": that would show a card its author meant to hide.
  // The DTO refuses a malformed rule first, so this is an invariant guard, not a message a person meets (no dictionary key).
  if (!when) throw new AppError('Unreadable visibility rule', 422, ErrorCode.VALIDATION_ERROR)
  return { when }
}

/**
 * A binding may only fill slots the widget DECLARES (`dataSpec`, phase 4b
 * §3.5) — the definition says "I need a series", the placement says which one.
 * Db-backed widgets and contributed (`ext:`) widgets carry a dataSpec (the latter
 * declared in the contribution's metadata, 18.2); manifest widgets are
 * self-contained components and take no binding, so any binding on one is a
 * mistake worth naming. Execution authority is NOT here — the query runner
 * re-authorizes every call regardless of what this jsonb says.
 */
/**
 * A placement of a tenant widget (`db:<id>`) reads that widget FOR SHARE on
 * the placing transaction: the widget delete (which counts placements with
 * the widget locked) waits for it and then sees it — a card can no longer be
 * placed on a widget deleted in the same instant (a dangling ref).
 *
 * When the delete commits FIRST, the read finds no row; that is a 422
 * `WIDGET_REF_INVALID` here (the answer an unresolvable ref already got from the slot
 * check), not a silent pass (dashboard.19), unless the id is a platform widget read
 * through from the root tenant (it has no row in this tenant by design).
 */
async function holdWidget(qr: QueryRunner, tenantId: string, widgetRef: string): Promise<{ visibility?: string }> {
  if (!widgetRef.startsWith('db:')) return {}
  const widgetId = widgetRef.slice(3)
  const row = await qr.manager.getRepository(DashboardWidget).findOne({
    where: { tenantId, widgetId },
    lock: { mode: 'pessimistic_read' },
  })
  if (!row && !(await findRootPublishedWidget(tenantId, widgetId))) {
    throw new AppError(MSG.WIDGET_REF_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  }
  // The held row's visibility: a create checks K10 again with it, on the board it holds (phase 39 review).
  return { visibility: row?.visibility }
}

/**
 * `holdWidget` for a card put back by a Discard (`DashboardBoardSnapshotService.restore`): the same read and lock, but a widget
 * that is gone answers false instead of a 422, so the restore leaves that card out rather than point it at a deleted widget.
 */
export async function holdWidgetIfPresent(qr: QueryRunner, tenantId: string, widgetRef: string): Promise<boolean> {
  try {
    await holdWidget(qr, tenantId, widgetRef)
    return true
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 422) return false
    throw e
  }
}

/**
 * The settings to store for a placement (15.4d, phase 21): the ONE validate-then-prune path every placement
 * write takes (create, patch, `createMany` for a template apply and a board import, the board duplicate), owner
 * decision 2026-10-18 #17. A builtin widget or a preset of one goes through its versioned template: migrated,
 * validated deeply, pruned, stamped (`widget-settings.ts`), and then asked of the `dashboard:placement_guard`
 * guards of its kind (31, C4: 422 `placement_guard_refused`, 503 when a guard cannot answer). Any other `db:` widget goes through its
 * `tenant:<type>` template (21.8): migrated, validated by the engine, pruned and stamped against the definition
 * it renders with: the one it last PUBLISHED, or the version the placement pins (7b), never the live draft. An
 * `ext:` widget is checked against the schema its contribution declares (18.2) and pruned to it. A key the
 * known schema does not declare is dropped, never stored. A kind with no schema to prune against (an iframe-tier
 * widget that declares none, a schemaless contribution, a `manifest:` widget) keeps its settings as given.
 * Whatever the kind, the stored object is bounded (`MAX_PLACEMENT_SETTINGS_BYTES`, 422 over it). `previous` is
 * the stored object being replaced (a stored part newer than this server refuses the write); absent or null, the
 * placement is new (a create, a copy), and the guards count everything it holds as added.
 */
export async function placementSettingsForSave(
  qr: QueryRunner,
  tenantId: string,
  widgetRef: string,
  settings: Record<string, unknown> | undefined,
  previous?: Record<string, unknown> | null,
  pinnedVersion?: number | null,
): Promise<Record<string, unknown>> {
  const out = await settingsForWidget(qr, tenantId, widgetRef, settings, previous, pinnedVersion)
  assertSettingsSize(out)
  return out
}

/** True when a definition declares at least one settings field. */
const declaresFields = (schema: unknown) => !!schema && typeof schema === 'object' && !Array.isArray(schema) && Object.keys(schema).length > 0

async function settingsForWidget(
  qr: QueryRunner,
  tenantId: string,
  widgetRef: string,
  settings: Record<string, unknown> | undefined,
  previous?: Record<string, unknown> | null,
  pinnedVersion?: number | null,
): Promise<Record<string, unknown>> {
  // Every widget gets the common card (phase 21); a builtin's whole settings go through its templates below.
  const value = settings && ('$card' in settings || '$v' in settings) ? prepareCardSettings(settings, previous) : (settings ?? {})
  if (widgetRef.startsWith('ext:')) {
    // A contributed widget validates against the schema its contribution declares (18.2) and is pruned to it
    // (#17); one that declares none keeps accepting whatever it did before.
    if (Object.keys(value).length === 0) return value
    const { findExtWidgetContract } = await import('./ext-widget')
    const contract = findExtWidgetContract(widgetRef.slice(4))
    const res = extSettingsForSave(contract?.schema, value)
    if (res.invalid.length) throw extSettingsInvalidError(res.invalid, contract?.schema)
    return res.settings
  }
  if (!widgetRef.startsWith('db:')) return value
  const widgetId = widgetRef.slice(3)
  const widget = await qr.manager.getRepository(DashboardWidget).findOne({ where: { tenantId, widgetId } })
    ?? await findRootPublishedWidget(tenantId, widgetId)
  if (!widget) return value
  const kind = kindForWidget(widget)
  if (kind) {
    const definitionDefaults = definitionDefaultsOf(widget)
    const prepared = prepareSettings(kind, settings ?? {}, { previous, definitionDefaults })
    // 2026-10-17 #9: an embed card may only be pointed at a site on the tenant's allow-list.
    const refused = await embedHostIssue(tenantId, kind, prepared, previous, definitionDefaults)
    if (refused) throw embedHostRefusedError(refused)
    // 31 (C4): the guards of the kind judge what the placement will draw against what it drew (a preset's defaults included).
    if (await isGuardedType(kind.type)) await assertKindGuards(qr, tenantId, kind, widget, prepared, previous ?? null, pinnedVersion)
    return prepared
  }
  const definition = await definitionForPlacement(qr, tenantId, widget, pinnedVersion)
  // #17: an iframe-tier widget frames third-party UI and usually declares no schema: nothing is known to prune
  // against, so its settings are kept as given (the common card still checked, the size cap still applies).
  if (definition.renderTier === 'iframe' && !declaresFields(definition.schema)) return value
  return prepareTenantSettings(definition, value, previous)
}

/**
 * The definition a placement of this row renders with (7b): the pinned version's snapshot when the
 * placement pins one this tenant has, else the last published one. A platform row, a row read through
 * from the root tenant and an unpinned placement follow `publishedDefinition`; a pin naming a version
 * that no longer exists degrades to it too, the rule `resolveForPlacement` follows.
 */
async function definitionForPlacement(
  qr: QueryRunner,
  tenantId: string,
  widget: DashboardWidget,
  pinnedVersion: number | null | undefined,
): Promise<DashboardWidget> {
  if (pinnedVersion == null || widget.isSystem || widget.tenantId !== tenantId) return publishedDefinition(qr, tenantId, widget)
  const version = await qr.manager.getRepository(DashboardWidgetVersion).findOne({
    where: { tenantId, widgetId: widget.widgetId, version: pinnedVersion },
  })
  return version ? applyPinnedSnapshot(widget, version.snapshot as object | null) : publishedDefinition(qr, tenantId, widget)
}

/**
 * A tenant widget as its placements see it: the definition fields of the version it last published
 * (15.4a). A row never published, a platform row read through from the root tenant, and a row whose
 * snapshot is missing are taken as they are, the rule `overlayPublished` follows.
 */
async function publishedDefinition(qr: QueryRunner, tenantId: string, widget: DashboardWidget): Promise<DashboardWidget> {
  if (widget.isSystem || widget.publishedVersion == null || widget.tenantId !== tenantId) return widget
  const version = await qr.manager.getRepository(DashboardWidgetVersion).findOne({
    where: { tenantId, widgetId: widget.widgetId, version: widget.publishedVersion },
  })
  return applyPublishedSnapshot(widget, version?.snapshot as object | null | undefined)
}

/**
 * A contributed widget's own action sources (`<type>.<name>`, 16.9) must be ones its contribution
 * declares, and `{ $row }` (or a condition on the row, E7) only on a source declared as carrying a row.
 * Without this a placement could store entries under any widget-looking source and nothing would ever
 * fire them. Core sources and the read-only `legacy.*` ones are not widget-declared and are left to the DTO.
 */
async function assertActionSources(widgetRef: string, actions: unknown): Promise<void> {
  if (!widgetRef.startsWith('ext:') || !actions) return
  const normalized = normalizeInstanceActions(actions)
  if (!normalized) return
  const dotted = Object.entries(normalized.sources).filter(([key]) => key.includes('.') && !key.startsWith('legacy.'))
  if (dotted.length === 0) return
  const { findExtWidgetContract } = await import('./ext-widget')
  const declared = new Map((findExtWidgetContract(widgetRef.slice(4))?.actionSources ?? []).map((s) => [s.key, s]))
  for (const [key, entries] of dotted) {
    const source = declared.get(key)
    if (!source) throw new AppError(`${MSG.ACTION_SOURCE_UNKNOWN}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
    if (!source.row && entries.some((e) => actionUsesRow(e.action as { kind: string }) || conditionUsesRow(e.when) || conditionUsesRow(e.pressedWhen))) {
      throw new AppError(`${MSG.ACTION_SOURCE_NO_ROW}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
  }
}

/**
 * `dashboard:placement_guard` (31, C4) for settings stored WITHOUT `placementSettingsForSave`: the cards `materialize` lays out
 * (stored as given) and a copied card whose stored value the save path now refuses (copied as stored). The guards of the
 * widget's builtin kind judge `settings` against `previous` (null: a new placement), with the defaults of the version the
 * placement draws (`pinnedVersion`, else the published one). Any other widget, or a kind no guard lists: nothing is read.
 * Throws the guard's 422 (`placement_guard_refused`) or a 503.
 */
export async function assertPlacementGuardsFor(
  qr: QueryRunner,
  tenantId: string,
  widgetRef: string,
  settings: Record<string, unknown> | null | undefined,
  previous: Record<string, unknown> | null,
  pinnedVersion?: number | null,
): Promise<void> {
  if (!widgetRef.startsWith('db:') || !(await hasPlacementGuards())) return
  const widgetId = widgetRef.slice(3)
  const widget = await qr.manager.getRepository(DashboardWidget).findOne({ where: { tenantId, widgetId } })
    ?? await findRootPublishedWidget(tenantId, widgetId)
  const kind = kindForWidget(widget)
  if (!widget || !kind || !(await isGuardedType(kind.type))) return
  await assertKindGuards(qr, tenantId, kind, widget, settings ?? {}, previous, pinnedVersion)
}

/**
 * Asks the guards of a builtin kind about a placement of `widget`, with the effective settings before and after. A preset's
 * defaults are those of the definition the placement DRAWS (`definitionForPlacement`: its pinned version, else the one it last
 * published), never the live draft: judged on the draft, a placement drawing a published locked symbol passed, and one drawing
 * a published open symbol was refused for a draft it never shows. The same definition draws both sides (a pin is the row's own).
 */
async function assertKindGuards(
  qr: QueryRunner,
  tenantId: string,
  kind: BuiltinKindSpec,
  widget: DashboardWidget,
  settings: Record<string, unknown>,
  previous: Record<string, unknown> | null,
  pinnedVersion: number | null | undefined,
): Promise<void> {
  const drawnDefaults = definitionDefaultsOf(await definitionForPlacement(qr, tenantId, widget, pinnedVersion))
  await assertPlacementGuards({
    tenantId,
    widgetType: kind.type,
    settings: effectiveKindSettings(kind, settings, drawnDefaults),
    previous: previous ? effectiveKindSettings(kind, previous, drawnDefaults) : null,
  })
}

/**
 * The builtin kind a `db:` placement renders (a platform row, or a preset of one); undefined for any other widget ref. Read
 * once per write, for the two checks that depend on the widget's kind: `dashboard:widget_kinds` (is the kind available to the
 * tenant) and `dashboard:element_actions` (which provider judges its element commands).
 */
export async function placementKind(qr: QueryRunner, tenantId: string, widgetRef: string): Promise<string | undefined> {
  if (!widgetRef.startsWith('db:')) return undefined
  const widgetId = widgetRef.slice(3)
  const widget = await qr.manager.getRepository(DashboardWidget).findOne({ where: { tenantId, widgetId } })
    ?? await findRootPublishedWidget(tenantId, widgetId)
  return kindTypeOf(widget)
}

/**
 * What a `db:` placement DRAWS, as the server sees it (phase 45.7, the "make this drawing editable" route): the builtin kind it renders and the kind's
 * own settings as the card resolves them, the template's defaults, then the preset's defaults, then the stored object after the template's upgrades
 * (`effectiveKindSettings`, the layers the placement guards are given). Read with the definition the placement draws (its pinned version, else the
 * published one). Null for a placement that is not a builtin kind (`manifest:`, `ext:`, a tenant template). The viewer's right to see the board is the
 * caller's (`placementBoardOr404`).
 */
export async function drawnSettingsOfPlacement(
  tenantId: string,
  instance: Pick<DashboardWidgetInstance, 'widgetRef' | 'settings' | 'pinnedVersion'>,
): Promise<{ kindType: string; settings: Record<string, unknown> } | null> {
  if (!instance.widgetRef.startsWith('db:')) return null
  const widgetId = instance.widgetRef.slice(3)
  return withTenantTransactionFor(tenantId, async (qr) => {
    const widget = await qr.manager.getRepository(DashboardWidget).findOne({ where: { tenantId, widgetId } })
      ?? await findRootPublishedWidget(tenantId, widgetId)
    const kind = kindForWidget(widget)
    if (!widget || !kind) return null
    const defaults = definitionDefaultsOf(await definitionForPlacement(qr, tenantId, widget, instance.pinnedVersion))
    return { kindType: kind.type, settings: effectiveKindSettings(kind, (instance.settings ?? {}) as Record<string, unknown>, defaults) }
  })
}

/**
 * The settings of `patch` that a scene binding owns for a builtin kind (phase 42.5, D42-12): the ones the kind's group declares in
 * `sceneOwnedSettings` (`builtinSceneContract`), present at the top level of the patch (a `null` removing one counts too). Empty for a kind that draws
 * no scene and for a group that is off.
 */
export async function sceneOwnedKeysOfKind(tenantId: string, kindType: string | undefined, patch: Record<string, unknown>): Promise<string[]> {
  if (!kindType) return []
  const contract = await builtinSceneContract(tenantId, kindType)
  return (contract?.owned ?? []).filter((k) => Object.hasOwn(patch, k))
}

async function assertBindingSlots(
  qr: QueryRunner,
  tenantId: string,
  widgetRef: string,
  binding: Record<string, unknown> | null | undefined,
  pinnedVersion?: number | null,
): Promise<void> {
  if (!binding || Object.keys(binding).length === 0) return
  if (widgetRef.startsWith('ext:')) {
    // A contributed widget takes a binding only for the slots its contribution declares (18.2).
    const { findExtWidgetContract } = await import('./ext-widget')
    const contract = findExtWidgetContract(widgetRef.slice(4))
    if (!contract) throw new AppError(MSG.WIDGET_REF_INVALID, 422, ErrorCode.VALIDATION_ERROR)
    assertDeclaredSlots(contract.dataSpec, binding)
    return
  }
  if (!widgetRef.startsWith('db:')) {
    throw new AppError(MSG.BINDING_SLOT_UNKNOWN, 422, ErrorCode.VALIDATION_ERROR)
  }
  const widgetId = widgetRef.slice(3)
  // Tenant first, platform catalogue second (D1) — the same order `get` uses — and then the definition
  // the board will actually render: the published one, or the pinned version (7b), not the live draft.
  const row = await qr.manager.getRepository(DashboardWidget).findOne({ where: { tenantId, widgetId } })
    ?? await findRootPublishedWidget(tenantId, widgetId)
  if (!row) throw new AppError(MSG.WIDGET_REF_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  const widget = await definitionForPlacement(qr, tenantId, row, pinnedVersion)
  const slots = Array.isArray(widget.dataSpec) ? widget.dataSpec as Array<{ key?: unknown; repeatable?: unknown }> : []
  assertDeclaredSlots(slots.map((s) => ({ key: String(s.key ?? ''), repeatable: s.repeatable === true })), binding)
}

/**
 * Every binding key must be a declared slot, and `<slot>#n` (an extra source, 18.3) only for a
 * slot declared `repeatable`: a widget that never asked for several sources cannot be handed them.
 */
function assertDeclaredSlots(
  declared: Array<{ key: string; repeatable?: boolean }>,
  binding: Record<string, unknown>,
): void {
  const byKey = new Map(declared.map((s) => [s.key, s]))
  for (const slotKey of Object.keys(binding)) {
    const { base, n } = splitSlotKey(slotKey)
    const slot = byKey.get(base)
    if (!slot || (n > 1 && !slot.repeatable)) {
      throw new AppError(`${MSG.BINDING_SLOT_UNKNOWN}: '${slotKey}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
  }
}

const surfaceOrder = { order: 'ASC' as const, y: 'ASC' as const, x: 'ASC' as const }

/** One card of a `createMany` (a template apply, a board import): a create without a required order. */
export type CreateManyItem = Omit<CreateInstanceInput, 'order'> & { order?: number }

/** One card of a `materialize` layout: a widget ref, its width and optional settings. */
export type MaterializeWidget = { ref: string; w: number; settings?: object }

/**
 * 422 when a card would not fit inside the board's columns (21.10). The DTOs bound geometry by the
 * widest grid (24), so a 12-column board needs this check to refuse `x: 10, w: 6`. A partial
 * update passes the stored values for whatever it does not change.
 */
export function assertFitsBoard(g: { x: number; w: number }, board: { gridCols?: number | null }): void {
  if (!fitsGrid(g, normalizeGridCols(board.gridCols))) {
    throw new AppError(MSG.GEOMETRY_OUTSIDE_GRID, 422, ErrorCode.VALIDATION_ERROR)
  }
}

/**
 * The column count of the surface a card is written to, read on the writing transaction (21.10).
 * The board row is read FOR SHARE, which conflicts with the column change's FOR UPDATE: a create either
 * waits for a column change that is running (and then checks the new count) or makes the change wait
 * until the insert commits (so its rescale sees the new card). A plain read let a card written for 24
 * columns land on a board that had just become 12-wide. A surface other than a board has no column
 * setting: 12.
 */
async function surfaceCols(qr: QueryRunner, tenantId: string, surface: SurfaceRef): Promise<number> {
  return (await surfaceBoard(qr, tenantId, surface)).cols
}

/**
 * The surface's columns and in-board pages (D-1 (a)), on the same FOR SHARE read: a page removal (board FOR UPDATE)
 * either waits for a card being written onto that page, and then sees it and refuses, or runs first, and the write
 * then sees the page is gone. A surface other than a board has no pages.
 */
async function surfaceBoard(qr: QueryRunner, tenantId: string, surface: SurfaceRef): Promise<SurfaceBoard> {
  if (surface.entityType !== 'DASHBOARD') return { cols: normalizeGridCols(undefined), pages: null, params: null, aliasKeys: {}, filters: null, scope: null }
  const raw = await qr.manager.getRepository(DashboardBoard).findOne({
    where: { tenantId, boardId: surface.entityId }, lock: { mode: 'pessimistic_read' },
  })
  // Phase 41: the board's parameters as one list, whatever age the row is, and its old alias keys for a card that still names one.
  const board = raw ? normalizeBoardRow(raw) : null
  return {
    cols: normalizeGridCols(board?.gridCols), pages: board?.pages ?? null, params: (board?.params ?? null) as BoardParam[] | null,
    aliasKeys: board ? boardAliasKeys(board) : {}, filters: (board?.filters ?? null) as Array<{ key: string }> | null,
    scope: board?.scope ?? null,
  }
}
interface SurfaceBoard { cols: number; pages: unknown; params: BoardParam[] | null; aliasKeys: Record<string, string>; filters: Array<{ key: string }> | null; scope: string | null }

/**
 * What a placement write stores of a binding or actions it was sent (phase 41, D41-7): checked to name only the board's entity
 * parameters and filters (E36-9), then with every `{ $alias }` written as the `{ $param }` of the entity parameter it is.
 */
function storedRefs<T>(value: T, board: SurfaceBoard, side: 'dataBinding' | 'actions'): T {
  assertPlacementEntityRefs({ [side]: value }, board.params, board.filters, board.aliasKeys)
  return normalizeParamRefs(value, board.aliasKeys).value
}

/** A surface's placements read on the caller's transaction (after `surfaceBoard` has taken the board lock). */
async function surfaceRows(qr: QueryRunner, tenantId: string, surface: SurfaceRef): Promise<DashboardWidgetInstance[]> {
  return qr.manager.getRepository(DashboardWidgetInstance).find({
    where: { tenantId, entityType: surface.entityType, entityId: surface.entityId },
    order: surfaceOrder,
  })
}

/** Where a `materialize` layout starts: the first row's y and the order the first card's is spaced after. */
export type MaterializeOpts = { startY?: number; startOrder?: number; byUserId?: string | null }

/**
 * Who is writing, for the checks a provider asks the caller about (`authoringPermission` of `dashboard:element_actions`). The
 * routes pass it from the caller's session. Left out, a write that needs such a permission is refused (fail closed): only a
 * trusted internal caller that never stores element commands may omit it.
 */
export type PlacementWriteOptions = {
  authoring?: ElementAuthoring
  /**
   * Who writes the card: the Discard copies other people hold of the board name them (`markSurfaceChanged`), on this write's
   * transaction. Left out, the writer is not known and every copy of the board is marked.
   */
  byUserId?: string | null
}

export default class DashboardInstanceService {
  /**
   * The cards of a board whose widget is PRIVATE to its author (K10), with the names a refusal shows: a share of the board is
   * refused while there is one (phase 39, UX-1), and a display link says the screen leaves them out (`displayRenderable`).
   * Read on the caller's `given` transaction when there is one (a share reads it under its board locks), else on a transaction of its own.
   */
  static async privateWidgetCards(tenantId: string, boardId: string, given?: QueryRunner): Promise<Array<{ instanceId: string; title: string | null; widgetName: string }>> {
    const read = async (qr: QueryRunner) => {
      const cards = (await qr.manager.getRepository(DashboardWidgetInstance).find({
        where: { tenantId, entityType: 'DASHBOARD', entityId: boardId },
        order: surfaceOrder,
      })).filter((i) => i.widgetRef.startsWith('db:'))
      if (cards.length === 0) return []
      const widgets = await qr.manager.getRepository(DashboardWidget).find({
        where: { tenantId, widgetId: In([...new Set(cards.map((i) => i.widgetRef.slice(3)))]), visibility: 'PRIVATE' },
      })
      const names = new Map(widgets.map((w) => [w.widgetId, w.label] as const))
      return cards
        .filter((i) => names.has(i.widgetRef.slice(3)))
        .map((i) => ({ instanceId: i.instanceId, title: i.title ?? null, widgetName: names.get(i.widgetRef.slice(3))! }))
    }
    return given ? read(given) : withTenantTransactionFor(tenantId, read)
  }

  static async listOnSurface(tenantId: string, surface: SurfaceRef): Promise<DashboardWidgetInstance[]> {
    return withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.find({
      where: { tenantId, entityType: surface.entityType, entityId: surface.entityId },
      order: surfaceOrder,
    }))
  }

  static async get(tenantId: string, instanceId: string): Promise<DashboardWidgetInstance> {
    const row = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.findOne({ where: { tenantId, instanceId } }))
    if (!row) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async create(
    tenantId: string,
    surface: SurfaceRef,
    dto: CreateInstanceInput,
    options: PlacementWriteOptions = {},
  ): Promise<DashboardWidgetInstance> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const held = await holdWidget(qr, tenantId, dto.widgetRef)
      // `dashboard:widget_kinds`: a kind whose module is off for this tenant cannot be placed (422).
      const kindType = await placementKind(qr, tenantId, dto.widgetRef)
      await assertKindAvailable(tenantId, kindType)
      const surfaceRow = await surfaceBoard(qr, tenantId, surface)
      await markSurfaceChanged(qr, tenantId, surface, options.byUserId ?? null)
      // K10 again on the board row this write holds: a share of the board (phase 39, UX-1) that committed after the route's
      // check made it a shared board, and a private widget must not land on it.
      assertWidgetPlaceable({ scope: surfaceRow.scope ?? '' }, held)
      assertFitsBoard(dto, { gridCols: surfaceRow.cols })
      assertPageOnBoard(dto.pageKey, surfaceRow.pages)
      assertActionPagesOnBoard(dto.actions, surfaceRow.pages)
      assertActionPageInputs(dto.actions, surfaceRow.pages, surfaceRow.params, dto.pageKey)
      await assertBindingSlots(qr, tenantId, dto.widgetRef, dto.dataBinding)
      // Phases 36 (E36-9), 41: a binding names only the board's entity parameters (422), stored as `{ $param }`.
      const dataBinding = storedRefs(dto.dataBinding ?? null, surfaceRow, 'dataBinding')
      const actions = storedRefs(dto.actions ?? null, surfaceRow, 'actions')
      const settings = await placementSettingsForSave(qr, tenantId, dto.widgetRef, dto.settings)
      await assertActionSources(dto.widgetRef, dto.actions)
      // Phase 35 (E9): every parameter the card's actions and rules name must be one of the board's (422). A direct write
      // only; an import repairs first (`board-package.import.ts`) and a template apply (`createMany`) is unchanged.
      assertPlacementParamRefsKnown({ actions: dto.actions, settings, visibility: dto.visibility }, surfaceRow.params)
      // `dashboard:element_actions`: a command on an element gesture is judged by the provider of the widget's kind.
      await assertElementCommands(tenantId, kindType, settings, dto.actions, { authoring: options.authoring })
      const repo = qr.manager.getRepository(DashboardWidgetInstance)
      return repo.save(repo.create({
        tenantId,
        entityType: surface.entityType,
        entityId: surface.entityId,
        widgetRef: dto.widgetRef,
        x: dto.x, y: dto.y, w: dto.w, h: dto.h,
        order: dto.order ?? 100,
        settings,
        dataBinding,
        actions,
        title: dto.title ?? null,
        refreshSeconds: dto.refreshSeconds ?? null,
        pageKey: dto.pageKey ?? null,
        visibility: storedVisibility(dto.visibility),
        transform: dto.transform ?? null,
        revision: 1,
      }))
    })
  }

  /**
   * Edit one card — ONLY the fields the patch names. A settings PATCH used to
   * save the whole card read before it, writing back the x/y/w/h from that
   * read: a layout save by someone arranging the board at the same moment was
   * silently undone for that card.
   *
   * Optimistic lock (15.3c): `expectedRevision`, when given, is checked on the
   * LOCKED row (two PATCHes carrying the same revision serialise here, the
   * second sees the bump and 409s, like `DashboardBoardService.update`). The 409
   * carries `details.revision`, the current one, so the editor can overwrite on
   * purpose. Absent = no check. A write that changes anything bumps the revision.
   */
  static async update(
    tenantId: string,
    instanceId: string,
    dto: UpdateInstanceInput,
    options: PlacementWriteOptions = {},
  ): Promise<DashboardWidgetInstance> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardWidgetInstance)
      // A geometry change takes the board lock BEFORE the placement lock, the order a column change takes them
      // (board FOR UPDATE, then its placements); the opposite order could deadlock the two (21.10). A placement
      // never moves to another surface, so the unlocked read of its surface is safe.
      // A page move takes the same board read: the page must exist when the card lands on it (D-1 (a)). New actions,
      // settings or a visibility rule take it too: the parameters they name must be the board's (E9).
      let cols: number | null = null
      let pages: unknown = null
      let params: unknown = null
      let surface: SurfaceBoard = { cols: normalizeGridCols(undefined), pages: null, params: null, aliasKeys: {}, filters: null, scope: null }
      const where = await repo.findOne({ where: { tenantId, instanceId }, select: { instanceId: true, entityType: true, entityId: true } })
      if (!where) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      if (dto.x !== undefined || dto.w !== undefined || dto.pageKey !== undefined || dto.actions !== undefined || dto.settings !== undefined || dto.visibility !== undefined || dto.dataBinding !== undefined) {
        const surfaceRow = await surfaceBoard(qr, tenantId, { entityType: where.entityType, entityId: where.entityId })
        cols = surfaceRow.cols
        pages = surfaceRow.pages
        params = surfaceRow.params
        surface = surfaceRow
      }
      // The Discard copies are marked with the write (after the board, before the card: the order a restore takes them).
      await markSurfaceChanged(qr, tenantId, where, options.byUserId ?? null)
      const row = await repo.findOne({ where: { tenantId, instanceId }, lock: { mode: 'pessimistic_write' } })
      if (!row) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      assertInstanceFresh(row, dto.expectedRevision)
      // The widget's kind decides two checks below; read it only for an edit of what the card shows or does (a move, a
      // resize or a title stays possible on a card whose kind is off, so the board can be tidied).
      const edited = dto.settings !== undefined || dto.dataBinding !== undefined || dto.actions !== undefined
      const kindType = edited ? await placementKind(qr, tenantId, row.widgetRef) : undefined
      if (edited) await assertKindAvailable(tenantId, kindType)
      if (cols !== null) assertFitsBoard({ x: dto.x ?? row.x, w: dto.w ?? row.w }, { gridCols: cols })
      const patch: Partial<DashboardWidgetInstance> = {}
      for (const key of ['x', 'y', 'w', 'h', 'order'] as const) {
        if (dto[key] !== undefined) patch[key] = dto[key] as number
      }
      if (dto.settings !== undefined) {
        patch.settings = await placementSettingsForSave(qr, tenantId, row.widgetRef, dto.settings, row.settings as Record<string, unknown> | null, row.pinnedVersion)
      }
      if (dto.dataBinding !== undefined) {
        await assertBindingSlots(qr, tenantId, row.widgetRef, dto.dataBinding, row.pinnedVersion)
        patch.dataBinding = storedRefs(dto.dataBinding ?? null, surface, 'dataBinding')
      }
      if (dto.actions !== undefined) {
        await assertActionSources(row.widgetRef, dto.actions)
        assertActionPagesOnBoard(dto.actions, pages)
        // The page the card will sit on holds the values its own inputs name, so its actions need not set them again.
        assertActionPageInputs(dto.actions, pages, params, dto.pageKey !== undefined ? dto.pageKey : row.pageKey)
        patch.actions = storedRefs(dto.actions ?? null, surface, 'actions')
      }
      if (dto.visibility !== undefined) patch.visibility = storedVisibility(dto.visibility)
      // E9: what this write changes (new actions, new settings, a new visibility rule) may only name the board's
      // parameters; what it leaves as stored is not re-judged, so a stale reference never blocks an unrelated edit (the
      // board update guards removals).
      if (dto.actions !== undefined || patch.settings !== undefined || dto.visibility !== undefined) {
        assertPlacementParamRefsKnown({
          actions: dto.actions !== undefined ? dto.actions : null, settings: patch.settings ?? null, visibility: dto.visibility !== undefined ? dto.visibility : null,
        }, params)
      }
      // Commands on element gestures (27.15): new actions are checked against the settings the placement will hold; new
      // settings must keep every element a stored command hangs off (a removed or renamed one is refused, like a page still
      // opened). Both are the widget kind's `dashboard:element_actions` provider's call.
      if (dto.actions !== undefined) {
        await assertElementCommands(tenantId, kindType, patch.settings ?? row.settings, dto.actions, { stored: row.actions, authoring: options.authoring })
      } else if (patch.settings !== undefined) {
        await assertSettingsKeepElementCommands(tenantId, kindType, patch.settings, row.actions)
      }
      if (dto.title !== undefined) patch.title = dto.title
      if (dto.refreshSeconds !== undefined) patch.refreshSeconds = dto.refreshSeconds
      if (dto.transform !== undefined) patch.transform = dto.transform ?? null
      if (dto.pageKey !== undefined && (dto.pageKey ?? null) !== (row.pageKey ?? null)) {
        assertPageOnBoard(dto.pageKey, pages)
        patch.pageKey = dto.pageKey ?? null
      }
      if (Object.keys(patch).length) {
        patch.revision = (row.revision ?? 1) + 1
        await repo.update({ tenantId, instanceId }, patch as never)
      }
      return Object.assign(row, patch)
    })
  }

  /**
   * The settings a card would show for one subject (phase 38, E38-8), judged exactly as a settings edit of the card is: the widget's
   * schema and templates, its kind's availability and guards (a locked symbol stays locked for one station too), the board's
   * parameters it may name, and the elements its stored commands hang off. Returns the settings as the save path stores them.
   */
  static async overlaySettings(
    qr: QueryRunner,
    tenantId: string,
    row: DashboardWidgetInstance,
    merged: Record<string, unknown>,
    /** The merge patch the caller sent (the write path of an overlay): what a scene binding owns may not be in it (D42-5). */
    patch?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // the contribution registry is read lazily here, as `assertBindingSlots` reads it
    const owned = patch ? (await import('./ext-widget')).sceneOwnedKeysIn(row.widgetRef, patch) : []
    if (owned.length > 0) throw new AppError(MSG.SCENE_OVERLAY_REFUSED, 422, ErrorCode.VALIDATION_ERROR, { details: { settings: owned } })
    const surfaceRow = await surfaceBoard(qr, tenantId, { entityType: row.entityType, entityId: row.entityId })
    const kindType = await placementKind(qr, tenantId, row.widgetRef)
    // a builtin kind that draws a scene (phase 42.5) owns its scene's settings as well: its group says which
    const ownedByKind = patch ? await sceneOwnedKeysOfKind(tenantId, kindType, patch) : []
    if (ownedByKind.length > 0) throw new AppError(MSG.SCENE_OVERLAY_REFUSED, 422, ErrorCode.VALIDATION_ERROR, { details: { settings: ownedByKind } })
    await assertKindAvailable(tenantId, kindType)
    const settings = await placementSettingsForSave(qr, tenantId, row.widgetRef, merged, row.settings as Record<string, unknown> | null, row.pinnedVersion)
    assertPlacementParamRefsKnown({ actions: null, settings, visibility: null }, surfaceRow.params)
    await assertSettingsKeepElementCommands(tenantId, kindType, settings, row.actions)
    return settings
  }

  static async remove(tenantId: string, instanceId: string, options: Pick<PlacementWriteOptions, 'byUserId'> = {}): Promise<void> {
    await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardWidgetInstance)
      const row = await repo.findOne({ where: { tenantId, instanceId } })
      if (!row) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
      await markSurfaceChanged(qr, tenantId, row, options.byUserId ?? null)
      // a card's overlays go with it (phase 38): nothing else reads them
      await qr.manager.getRepository(DashboardCardOverlay).delete({ tenantId, instanceId })
      await repo.delete({ tenantId, instanceId })
    })
  }

  /**
   * Move every card of a surface on the caller's transaction — position
   * columns only, and only cards that are on THIS surface. The board-gated
   * caller is `DashboardBoardService.saveLayout` (board locked, revision
   * checked and bumped in the same transaction).
   *
   * A card whose geometry actually changes gets its own revision bumped too
   * (15.3c); an unchanged card keeps its revision, so a layout save does not
   * make every open settings drawer stale. There is no per-card
   * `expectedRevision` here: the layout is gated as a whole by the BOARD
   * revision (a concurrent arrangement already 409s), and a placement PATCH
   * writes only the fields it names, so geometry never races a settings edit.
   * The cards are read FOR UPDATE, so a concurrent PATCH of one serialises
   * with the move and neither bump is lost.
   */
  static async applyLayout(qr: QueryRunner, tenantId: string, surface: SurfaceRef, dto: SaveLayoutInput): Promise<void> {
    if (dto.items.length === 0) return
    // Every layout write is bounded by the surface's columns here, whichever caller wrote it (21.10).
    const cols = await surfaceCols(qr, tenantId, surface)
    for (const item of dto.items) assertFitsBoard(item, { gridCols: cols })
    const repo = qr.manager.getRepository(DashboardWidgetInstance)
    const current = new Map((await repo.find({
      where: { tenantId, entityType: surface.entityType, entityId: surface.entityId },
      lock: { mode: 'pessimistic_write' },
    })).map((row) => [row.instanceId, row]))
    for (const item of dto.items) {
      const row = current.get(item.instanceId)
      // A card of another surface (or none) is not moved — same rule as before, now explicit.
      if (!row) continue
      const moved = row.x !== item.x || row.y !== item.y || row.w !== item.w || row.h !== item.h || row.order !== item.order
      if (!moved) continue
      await repo.update(
        { tenantId, instanceId: item.instanceId, entityType: surface.entityType, entityId: surface.entityId },
        { x: item.x, y: item.y, w: item.w, h: item.h, order: item.order, revision: (row.revision ?? 1) + 1 },
      )
    }
  }

  static async saveLayout(
    tenantId: string,
    surface: SurfaceRef,
    dto: SaveLayoutInput,
  ): Promise<DashboardWidgetInstance[]> {
    return withTenantTransactionFor(tenantId, async (qr) => {
      await DashboardInstanceService.applyLayout(qr, tenantId, surface, dto)
      return qr.manager.getRepository(DashboardWidgetInstance).find({
        where: { tenantId, entityType: surface.entityType, entityId: surface.entityId },
        order: surfaceOrder,
      })
    })
  }

  /**
   * Place several cards on a surface in ONE transaction — a template apply: either
   * every placement lands or none does. Each goes through the same slot check a
   * single `create` does (`assertBindingSlots`), so a template binding a slot its
   * widget does not declare fails the apply instead of storing a dead binding.
   *
   * `items` may be a function of the board's column count and the surface's placements: it is then called with
   * the count read FOR SHARE on this transaction (`surfaceBoard`) and the placements read AFTER that lock, so a
   * caller that scales geometry to the board or stacks below its cards (a template applied onto an existing board,
   * owner decision 15) works against what the cards are actually written next to, never a snapshot a concurrent
   * column change (which rescales and can push cards down) has since replaced.
   */
  static async createMany(
    tenantId: string,
    surface: SurfaceRef,
    itemsOrFor: CreateManyItem[] | ((cols: number, existing: DashboardWidgetInstance[]) => CreateManyItem[]),
    options: PlacementWriteOptions = {},
  ): Promise<DashboardWidgetInstance[]> {
    if (Array.isArray(itemsOrFor) && itemsOrFor.length === 0) return []
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardWidgetInstance)
      const rows: DashboardWidgetInstance[] = []
      const { cols, pages, params, aliasKeys } = await surfaceBoard(qr, tenantId, surface)
      const items = typeof itemsOrFor === 'function' ? itemsOrFor(cols, await surfaceRows(qr, tenantId, surface)) : itemsOrFor
      if (items.length === 0) return []
      await markSurfaceChanged(qr, tenantId, surface, options.byUserId ?? null)
      for (const [i, dto] of items.entries()) {
        assertFitsBoard(dto, { gridCols: cols })
        assertPageOnBoard(dto.pageKey, pages)
        assertActionPagesOnBoard(dto.actions, pages)
        assertActionPageInputs(dto.actions, pages, params, dto.pageKey)
        await holdWidget(qr, tenantId, dto.widgetRef)
        const kindType = await placementKind(qr, tenantId, dto.widgetRef)
        await assertKindAvailable(tenantId, kindType)
        await assertBindingSlots(qr, tenantId, dto.widgetRef, dto.dataBinding)
        const settings = await placementSettingsForSave(qr, tenantId, dto.widgetRef, dto.settings)
        await assertActionSources(dto.widgetRef, dto.actions)
        await assertElementCommands(tenantId, kindType, settings, dto.actions, { authoring: options.authoring })
        rows.push(repo.create({
          tenantId,
          entityType: surface.entityType,
          entityId: surface.entityId,
          widgetRef: dto.widgetRef,
          x: dto.x, y: dto.y, w: dto.w, h: dto.h,
          order: dto.order ?? (i + 1) * 10,
          settings,
          // Stored in the phase 41 form, whatever an import or a template carried (D41-7).
          dataBinding: normalizeParamRefs(dto.dataBinding ?? null, aliasKeys).value,
          actions: normalizeParamRefs(dto.actions ?? null, aliasKeys).value,
          title: dto.title ?? null,
          refreshSeconds: dto.refreshSeconds ?? null,
          pageKey: dto.pageKey ?? null,
          visibility: storedVisibility(dto.visibility),
          transform: dto.transform ?? null,
          revision: 1,
        }))
      }
      return repo.save(rows)
    })
  }

  /**
   * Lay cards out left to right on a surface, wrapping at the board's columns (a new workspace/module board, a
   * sections template). The column count is read FOR SHARE on the writing transaction, like every other placement
   * write (`surfaceBoard`, 21.10): a column change either waits for these inserts (and then rescales them) or runs
   * first (and the layout uses the new count). `widgets` may be a function of that count, for cards whose width is
   * the board's full width. A card wider than the board is narrowed to it, and every card is checked to fit
   * (`assertFitsBoard`) before anything is stored. `optsOrFor` may be a function of the surface's placements read
   * after the board lock, for a caller that starts below the cards already there (decision 15): a column change
   * committed before the lock has rescaled them (and may have pushed some down), so their bottom edge is only known
   * here.
   */
  static async materialize(
    tenantId: string,
    surface: SurfaceRef,
    widgetsOrFor: MaterializeWidget[] | ((cols: number) => MaterializeWidget[]),
    optsOrFor: MaterializeOpts | ((existing: DashboardWidgetInstance[]) => MaterializeOpts) = {},
  ): Promise<DashboardWidgetInstance[]> {
    if (Array.isArray(widgetsOrFor) && widgetsOrFor.length === 0) return []
    return withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(DashboardWidgetInstance)
      const { cols } = await surfaceBoard(qr, tenantId, surface)
      const widgets = typeof widgetsOrFor === 'function' ? widgetsOrFor(cols) : widgetsOrFor
      const opts = typeof optsOrFor === 'function' ? optsOrFor(await surfaceRows(qr, tenantId, surface)) : optsOrFor
      if (widgets.length > 0) await markSurfaceChanged(qr, tenantId, surface, opts.byUserId ?? null)
      // The cards are stored as given, so the guards of a builtin kind (31, C4) are asked here (a new placement each).
      for (const widget of widgets) await assertPlacementGuardsFor(qr, tenantId, widget.ref, (widget.settings ?? {}) as Record<string, unknown>, null)
      let x = 0
      let y = opts.startY ?? 0
      const rows = widgets.map((widget, i) => {
        const w = Math.max(1, Math.min(widget.w, cols))
        if (x > 0 && x + w > cols) { x = 0; y += 4 }
        assertFitsBoard({ x, w }, { gridCols: cols })
        const row = repo.create({
          tenantId,
          entityType: surface.entityType,
          entityId: surface.entityId,
          widgetRef: widget.ref,
          x, y, w, h: 4,
          order: (opts.startOrder ?? 0) + (i + 1) * 10,
          settings: widget.settings ?? {},
          revision: 1,
        })
        x += w
        return row
      })
      return rows.length ? repo.save(rows) : []
    })
  }
}

/** 409 when the editor's loaded placement revision is behind the stored one; the current one rides along. */
export function assertInstanceFresh(row: { revision: number }, expectedRevision?: number): void {
  if (expectedRevision !== undefined && expectedRevision !== row.revision) {
    throw new AppError(MSG.INSTANCE_CONFLICT, 409, ErrorCode.CONFLICT, { details: { revision: row.revision } })
  }
}
