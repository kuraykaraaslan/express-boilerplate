import 'reflect-metadata'
import { DashboardBoard } from './entities/dashboard_board.entity'
import type { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import DashboardBoardService, { type BoardViewer } from './board.crud.service'
import DashboardInstanceService, { type PlacementWriteOptions } from './instance.crud.service'
import { VALUE_CHAIN_WIDGET_REF, type BoardTemplate, type TemplatePlacement } from './board-templates'
import { partitionCopyableRefs } from './board.acl'
import { validateParamValue } from './board-window'
import { entityParamValue, isEntityParam, type BoardParam } from './board-params'
import { normalizeGridCols, scaleLayout } from './grid-cols'
import { answeredParams, type TemplateAnswers } from './board-template.answers'

export interface ApplyTemplateOptions extends PlacementWriteOptions {
  /**
   * Widget refs this caller may place (resolved + not PRIVATE-on-shared by the
   * route). A placement whose ref is absent is SKIPPED and reported by name —
   * the `duplicate()` precedent — never silently dropped. Omitted = sections
   * only, which place one known manifest widget the route already checked.
   */
  resolvable?: Set<string>
  /**
   * "Duplicate" from a transient render: a new personal, non-default board with a
   * minted slug, whatever the anchor already has. Not idempotent on purpose.
   */
  asCopy?: boolean
  /** Viewer's parameter values at the moment of copying; saved as the new board's defaults. */
  paramValues?: Record<string, unknown>
  /**
   * Phase 49b, "New dashboard" from a template: a board of its own with the person's title, description, scope and workspace, never the anchor's
   * default and never idempotent (each create is a new board). Not combined with `asCopy`.
   */
  asNew?: { title: string; description?: string | null; scope: 'TENANT' | 'PRIVATE'; workspace?: string | null }
  /** Phase 49b: the answer to the template's question, written into the asked parameter (`answeredParams`). */
  answers?: TemplateAnswers
}

/**
 * The placements that will actually be stored, and the refs that were left out. A card whose widget the caller cannot place takes its fallback card
 * (phase 49b: same cells and page, another widget) when the caller can place that one; only a card with neither is skipped and reported by name.
 */
export function partitionPlacements(
  placements: TemplatePlacement[],
  resolvable: Set<string>,
): { keep: TemplatePlacement[]; skipped: string[] } {
  // the card as it is stored: the main one, or its fallback on the main one's cells and page; never the fallback field itself
  const placed = (p: TemplatePlacement, card: Partial<TemplatePlacement> = {}): TemplatePlacement => {
    const out: TemplatePlacement = { ...p, ...card }
    delete out.fallback
    return out
  }
  const chosen = placements.map((p) => (
    resolvable.has(p.widgetRef) || !p.fallback || !resolvable.has(p.fallback.widgetRef) ? placed(p) : placed(p, p.fallback)
  ))
  const { skipped } = partitionCopyableRefs(chosen.map((p) => p.widgetRef), resolvable)
  return { keep: chosen.filter((p) => resolvable.has(p.widgetRef)), skipped }
}

/** Template params with the viewer's current values written in as defaults (for a copy). */
export function paramsWithDefaults(
  params: BoardParam[] | undefined,
  values: Record<string, unknown> | undefined,
): BoardParam[] | null {
  if (!params?.length) return null
  return params.map((p) => {
    // A viewer-supplied value becomes the copy's stored default only when it passes the param's own
    // field; otherwise the template's default stays, so the copied board never fails its own schema (dashboard.12).
    if (!values || !Object.prototype.hasOwnProperty.call(values, p.key)) return { ...p }
    if (isEntityParam(p)) {
      // One entity's id, on a parameter of one entity chosen from a set (phase 41); the set is checked when it resolves. A page
      // choice that follows another parameter holds that one's entity, never a default of its own (the schema refuses it).
      const id = entityParamValue(p, values[p.key])
      const follows = p.choose.type === 'page' && p.choose.param !== undefined
      const takes = typeof id === 'string' && !p.multiple && !follows && p.choose.type !== 'single' && (p.choose.type !== 'list' || p.choose.ids.includes(id))
      return takes ? { ...p, default: id } : { ...p }
    }
    const checked = validateParamValue(p, values[p.key])
    return checked.ok ? { ...p, default: checked.value } : { ...p }
  })
}

/**
 * A template's placements, written on `from` columns, re-expressed on `to` columns (owner decision 15) with the SAME
 * rule the board column change and kui-react's WidgetBoard use (`scaleLayout`): both edges of each card scale and
 * round, each card stays at least one column wide and inside the grid, and cards that collapse onto the same cells are
 * pushed down. A no-op (bar clamping) when the counts match. Pure.
 */
export function scaleTemplatePlacements(placements: TemplatePlacement[], from: number, to: number): TemplatePlacement[] {
  const rects = placements.map((p, i) => ({ id: String(i).padStart(4, '0'), x: p.x, y: p.y, w: p.w, h: p.h }))
  return scaleLayout(rects, from, to).map((r, i) => (
    r.x === placements[i].x && r.y === placements[i].y && r.w === placements[i].w
      ? placements[i]
      : { ...placements[i], x: r.x, y: r.y, w: r.w }
  ))
}

export default class BoardTemplateService {
  /**
   * Create the template's board and seed it, in one call.
   *
   * Sections (the original form) place one `entity-counts` card per section.
   * Placements (phase 13) place real widgets with geometry, settings, bindings and
   * actions, and the template's default `timeWindow` / `params` become the board's.
   *
   * The caller (the route) only reaches this after confirming
   * `DashboardBoardService.findDefault(tenantId, viewer, template.anchor)`
   * returned null — unless `asCopy` — the same guard
   * `dashboard-workspaces-workspace-board.route.ts` uses before materializing the
   * implicit workspace board. That is what makes `isDefault: true` here safe
   * rather than a silent takeover: an anchor that already has a default
   * (hand-customised, or a template applied earlier) keeps it.
   *
   * `hasManage` (Faz 9, K4): without `dashboard.boards.manage`, applying a
   * template must not turn the anchor's SHARED default into this caller's
   * pick. The result is this caller's own personal default instead.
   */
  static async apply(
    tenantId: string,
    viewer: BoardViewer,
    template: BoardTemplate,
    hasManage: boolean,
    options: ApplyTemplateOptions = {},
  ): Promise<{ board: DashboardBoard; skipped: string[] }> {
    const extras = {
      timeWindow: (template.timeWindow ?? null) as Record<string, unknown> | null,
      params: (options.asCopy
        ? paramsWithDefaults(template.params, options.paramValues)
        // phase 49b: the person's answer to the template's question is the asked parameter's choice
        : (answeredParams(template, options.answers) ?? null)) as Array<Record<string, unknown>> | null,
      // Phase 29: the template's pages, so its cards land on them and its actions can open them.
      ...(template.pages?.length ? { pages: template.pages } : {}),
      ...(template.mainPage ? { mainPage: template.mainPage } : {}),
    }
    const cols = normalizeGridCols(template.gridCols)
    const base = {
      title: template.title,
      description: template.description ?? null,
      workspace: template.anchor.workspace ?? null,
      moduleId: template.anchor.moduleId ?? null,
      // A new board gets the template's own columns, so its placements land exactly as written (owner decision 15).
      gridCols: cols,
      ...extras,
    }
    const board = await DashboardBoardService.create(
      tenantId,
      options.asNew
        // phase 49b: a board of its own, as the New dashboard dialog makes one (the route checked the scope against the caller)
        ? {
          ...base, title: options.asNew.title, description: options.asNew.description ?? null,
          workspace: options.asNew.workspace ?? null, moduleId: null, scope: options.asNew.scope, isDefault: false,
        }
        : options.asCopy
        ? { ...base, scope: 'PRIVATE', isDefault: false }
        : hasManage
          ? { ...base, slug: `template-${template.key}`, scope: 'TENANT', isDefault: true }
          : { ...base, slug: `template-${template.key}-${viewer.userId}`.slice(0, 64), scope: 'PRIVATE', isDefault: true },
      viewer,
    )
    const surface = { entityType: 'DASHBOARD', entityId: board.boardId }

    if (template.placements?.length) {
      const { keep, skipped } = partitionPlacements(template.placements, options.resolvable ?? new Set())
      try {
        await DashboardInstanceService.createMany(tenantId, surface, keep.map((p) => ({
          widgetRef: p.widgetRef, x: p.x, y: p.y, w: p.w, h: p.h,
          settings: p.settings, dataBinding: p.dataBinding, actions: p.actions,
          title: p.title, refreshSeconds: p.refreshSeconds,
          ...(p.pageKey ? { pageKey: p.pageKey } : {}),
        })), { authoring: options.authoring })
      } catch (e) {
        // Board and placements are separate transactions: a template whose binding
        // does not match its widget must not leave an empty board behind.
        await DashboardBoardService.remove(tenantId, board.boardId, viewer).catch(() => undefined)
        throw e
      }
      return { board, skipped }
    }

    // Full-width cards on the board's columns, read on the writing transaction (the board was just created on `cols`).
    await DashboardInstanceService.materialize(tenantId, surface, (boardCols) => sectionWidgets(template, boardCols))
    return { board, skipped: [] }
  }

  /**
   * Place a template's cards onto an EXISTING board (owner decision 15), below everything already on its main page.
   * Placements are rescaled from the template's columns to the board's (`scaleTemplatePlacements`), so a 24-column
   * template on a 12-column board (and the reverse) keeps each card's share of the width. The board's own window and
   * params are left alone: they belong to the board, not to the cards added to it. The route has already checked the
   * caller may write the board and resolved which widgets they may place (`resolvable`).
   *
   * The board's column count is NOT taken from the route's snapshot (`board.gridCols`, read before this call): it
   * is read FOR SHARE on the transaction that writes the cards (`createMany` / `materialize`, the 21.10 rule every
   * placement write follows), and the scaling runs against that value. A column change committed in between (24 -> 12)
   * therefore cannot leave a `w: 24` card on a 12-column board, and one running concurrently waits for these inserts
   * and then rescales them with everything else. Where the cards start (`belowMainPage`: the main page's bottom edge
   * and the highest order) is read on that same transaction after the lock too: the rescale a column change runs can
   * push colliding cards down, so a bottom edge read before it would stack the template on top of them.
   */
  static async applyOnto(
    tenantId: string,
    board: Pick<DashboardBoard, 'boardId'> & Partial<Pick<DashboardBoard, 'gridCols'>>,
    template: BoardTemplate,
    options: Pick<ApplyTemplateOptions, 'resolvable' | 'authoring' | 'byUserId'> = {},
  ): Promise<{ skipped: string[]; placed: number }> {
    const surface = { entityType: 'DASHBOARD', entityId: board.boardId }

    if (template.placements?.length) {
      // Phase 29: the board keeps its own pages (like its params), so only the template's main-page cards are added, and
      // an action that would open one of the template's pages is left out of them (the board has no such page).
      const mainCards = template.placements.filter((p) => !p.pageKey).map((p) => ({ ...p, actions: withoutPageActions(p.actions) }))
      const { keep, skipped } = partitionPlacements(mainCards, options.resolvable ?? new Set())
      const from = normalizeGridCols(template.gridCols)
      const rows = await DashboardInstanceService.createMany(tenantId, surface, (boardCols, existing) => {
        const { top, order } = belowMainPage(existing)
        return scaleTemplatePlacements(keep, from, normalizeGridCols(boardCols)).map((p, i) => ({
          widgetRef: p.widgetRef, x: p.x, y: top + p.y, w: p.w, h: p.h, order: order + (i + 1) * 10,
          settings: p.settings, dataBinding: p.dataBinding, actions: p.actions,
          title: p.title, refreshSeconds: p.refreshSeconds,
        }))
      }, { authoring: options.authoring, byUserId: options.byUserId })
      return { skipped, placed: rows.length }
    }

    const rows = await DashboardInstanceService.materialize(
      tenantId, surface, (boardCols) => sectionWidgets(template, boardCols),
      (existing) => {
        const { top, order } = belowMainPage(existing)
        return { startY: top, startOrder: order, byUserId: options.byUserId }
      },
    )
    return { skipped: [], placed: rows.length }
  }
}

/**
 * Where cards appended to a board start: below the main page's bottom edge (another page's cards do not push them
 * down) and ordered after every card on the board. Fed the placements read under the board lock (`createMany` /
 * `materialize`), never a snapshot taken before it.
 */
function belowMainPage(existing: Array<Pick<DashboardWidgetInstance, 'y' | 'h' | 'order' | 'pageKey'>>): { top: number; order: number } {
  const mainPage = existing.filter((row) => !row.pageKey)
  return {
    top: Math.max(0, ...mainPage.map((row) => row.y + row.h)),
    order: Math.max(0, ...existing.map((row) => row.order)),
  }
}

/** A sections template's cards: one full-width `entity-counts` card per section, on `cols` columns. */
function sectionWidgets(template: BoardTemplate, cols: number): Array<{ ref: string; w: number; settings: object }> {
  return (template.sections ?? []).map((section) => ({
    ref: VALUE_CHAIN_WIDGET_REF,
    w: cols,
    settings: { keys: section.countableKeys, title: section.title },
  }))
}

/**
 * A placement's actions without the entries that open an in-board page (phase 29): placed onto a board that does not
 * have the template's pages, they would open nothing (and the write would refuse them). The main page (`null`) stays.
 */
export function withoutPageActions<T>(actions: T): T {
  if (!actions || typeof actions !== 'object') return actions
  const opensPage = (a: unknown) => !!a && typeof a === 'object' && (a as { kind?: unknown }).kind === 'openPage' && (a as { page?: unknown }).page != null
  const v1 = actions as { onClick?: unknown }
  if ('onClick' in v1 && !('v' in (actions as object))) return (opensPage(v1.onClick) ? { ...v1, onClick: null } : actions) as T
  const v2 = actions as { v?: number; sources?: Record<string, Array<{ action?: unknown }>> }
  if (!v2.sources) return actions
  const sources: Record<string, Array<{ action?: unknown }>> = {}
  for (const [key, entries] of Object.entries(v2.sources)) {
    const kept = (entries ?? []).filter((e) => !opensPage(e?.action))
    if (kept.length) sources[key] = kept
  }
  return { ...v2, sources } as T
}
