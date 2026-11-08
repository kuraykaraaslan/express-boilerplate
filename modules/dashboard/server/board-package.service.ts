import 'reflect-metadata'
import type { DashboardBoard } from './entities/dashboard_board.entity'
import DashboardBoardService, { type BoardViewer } from './board.crud.service'
import DashboardInstanceService, { type PlacementWriteOptions } from './instance.crud.service'
import type { BundlePlan, ImportPlan } from './board-package.import'
import { mapOpenBoardTargets } from './board-package'
import { normalizeGridCols } from './grid-cols'

/**
 * Apply an import plan (phase 19.2): create the board, then its placements, through the same
 * services a hand-made board uses (so access rules, entitlement of the surface, settings and slot
 * validation, and audit hooks all apply; nothing is written to a table directly).
 *
 * The board is always created as a plain, non-default board with no anchor: where it appears is the
 * importing user's choice afterwards, not something a file can decide. `scope: 'TENANT'` is the
 * route's call (it needs `dashboard.boards.manage`); a personal board is the default.
 */
export default class DashboardBoardPackageService {
  static async apply(
    tenantId: string,
    viewer: BoardViewer,
    plan: ImportPlan,
    options: { scope: 'TENANT' | 'PRIVATE'; title?: string } & PlacementWriteOptions,
  ): Promise<DashboardBoard> {
    const board = await this.createBoard(tenantId, viewer, plan, options)
    if (plan.placements.length === 0) return board
    try {
      await DashboardInstanceService.createMany(
        tenantId,
        { entityType: 'DASHBOARD', entityId: board.boardId },
        plan.placements.map((p) => p.input) as never,
        { authoring: options.authoring },
      )
    } catch (e) {
      // Board and placements are separate transactions: a failed placement must not leave an
      // empty board behind (the template apply precedent).
      await DashboardBoardService.remove(tenantId, board.boardId, viewer).catch(() => undefined)
      throw e
    }
    return board
  }

  /**
   * Apply a bundle plan (19.6), all or nothing: every board first (so each `openBoard` between
   * members has a target), then each board's placements with those targets rewritten from the
   * bundle-local ref to the new board's id. If any board or placement is refused, every board this
   * call created is removed again (which removes its placements too) and the first error is rethrown.
   * Returns the new boards in bundle order, with the ref each one replaced.
   */
  static async applyBundle(
    tenantId: string,
    viewer: BoardViewer,
    plan: BundlePlan,
    options: { scope: 'TENANT' | 'PRIVATE'; title?: string } & PlacementWriteOptions,
  ): Promise<Array<{ ref: string; board: DashboardBoard }>> {
    const created: Array<{ ref: string; board: DashboardBoard }> = []
    try {
      for (const b of plan.boards) {
        const board = await this.createBoard(tenantId, viewer, b.plan, { scope: options.scope, title: b.root ? options.title : undefined })
        created.push({ ref: b.ref, board })
      }
      const idOf = new Map(created.map((c) => [c.ref, c.board.boardId]))
      for (const [i, b] of plan.boards.entries()) {
        if (b.plan.placements.length === 0) continue
        await DashboardInstanceService.createMany(
          tenantId,
          { entityType: 'DASHBOARD', entityId: created[i].board.boardId },
          b.plan.placements.map((p) => ({ ...p.input, actions: mapOpenBoardTargets(p.input.actions, (id) => idOf.get(id) ?? id) })) as never,
          { authoring: options.authoring },
        )
      }
    } catch (e) {
      for (const c of created.reverse()) await DashboardBoardService.remove(tenantId, c.board.boardId, viewer).catch(() => undefined)
      throw e
    }
    return created
  }

  /** The plain board an import creates: non-default, no anchor, no slug. */
  private static createBoard(
    tenantId: string,
    viewer: BoardViewer,
    plan: ImportPlan,
    options: { scope: 'TENANT' | 'PRIVATE'; title?: string } & PlacementWriteOptions,
  ): Promise<DashboardBoard> {
    return DashboardBoardService.create(
      tenantId,
      {
        title: options.title ?? plan.board.title,
        description: plan.board.description ?? null,
        icon: plan.board.icon ?? null,
        scope: options.scope,
        isDefault: false,
        timeWindow: (plan.board.timeWindow ?? null) as Record<string, unknown> | null,
        params: (plan.board.params ?? null) as Array<Record<string, unknown>> | null,
        filters: (plan.board.filters ?? null) as Array<Record<string, unknown>> | null,
        settings: (plan.board.settings ?? null) as Record<string, unknown> | null,
        gridCols: normalizeGridCols(plan.board.gridCols),
        pages: plan.board.pages ?? null,
        mainPage: plan.board.mainPage ?? null,
      },
      viewer,
    )
  }
}
