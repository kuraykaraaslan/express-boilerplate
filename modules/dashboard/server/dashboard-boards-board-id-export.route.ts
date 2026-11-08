import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolvePinnedDefinitions, resolvePlacedWidgets } from './widget-catalog.service'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import { boardAliasKeys, normalizePlacementRefs } from './board-params'
import { buildBoardPackage, packageFileName } from './board-package'
import { buildBoardBundle, bundleFileName, collectLinkedBoards } from './board-package.bundle'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/**
 * GET …/dashboard/boards/[boardId]/export — the board as a package (phase 19.1).
 *
 * Needs `dashboard.boards.read` and the same visibility as opening the board (someone else's
 * private board is a 404). A placement whose widget this caller cannot resolve is left out of
 * the package and listed in `skipped`, so an export never reveals a widget its exporter may not
 * open. The package carries no tenant or user ids. The body is the package itself, as a file
 * download, so it can be saved as it comes; `?report=1` returns `{ package, skipped }` as plain JSON
 * for the UI, which wants to show what was left out.
 *
 * `?linked=1` (19.6) exports a bundle instead: this board plus, transitively, every board its
 * `openBoard` actions reach that the caller can open (each loaded with the same visibility rule as
 * this one), up to `MAX_BUNDLE_BOARDS`. With `?report=1` the answer is `{ package, skipped, leftOut }`,
 * `leftOut` naming each linked board not taken (not visible to the caller, or over the cap); those
 * stay ordinary external links in the file.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const build = async (b: typeof board) => {
      // A card stored before phase 41 travels with the `{ $param }` its `{ $alias }` now is (D41-7).
      const instances = (await DashboardInstanceService.listOnSurface(tenantId, { entityType: 'DASHBOARD', entityId: b.boardId }))
        .map((i) => normalizePlacementRefs(i, boardAliasKeys(b)).placement)
      const descriptors = await resolvePlacedWidgets({
        request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
        refs: instances.map((i) => i.widgetRef),
      })
      // 7b: a pinned card exports stamped at its pinned version (the package carries no pin; import migrates it up).
      const pinned = await resolvePinnedDefinitions(tenantId, instances, descriptors)
      return buildBoardPackage({ board: b, instances, descriptors, pinned })
    }
    const query = new URL(request.url).searchParams
    const asReport = query.get('report') === '1'

    if (query.get('linked') === '1') {
      const { members, leftOut } = await collectLinkedBoards(board.boardId, async (id) => {
        if (id === board.boardId.toLowerCase()) return build(board)
        const linked = await DashboardBoardService.get(tenantId, id, { userId: ctx.userId }).catch((e: unknown) => {
          // Not visible (or gone) = left out; anything else is a real failure.
          if ((e as { statusCode?: number }).statusCode === 404) return null
          throw e
        })
        return linked ? build(linked) : null
      })
      const { bundle, skipped } = buildBoardBundle({ members })
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.board.export', resourceType: 'dashboard_board',
        resourceId: board.boardId,
        metadata: { boards: bundle.boards.length, placements: bundle.boards.reduce((n, m) => n + m.package.placements.length, 0), skipped: skipped.length, leftOut: leftOut.length },
      })
      if (asReport) return NextResponse.json({ package: bundle, skipped, leftOut })
      return download(bundle, bundleFileName(board.title))
    }

    const { package: pkg, skipped } = await build(board)
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.export', resourceType: 'dashboard_board',
      resourceId: board.boardId, metadata: { placements: pkg.placements.length, skipped: skipped.length },
    })
    if (asReport) return NextResponse.json({ package: pkg, skipped })
    return download(pkg, packageFileName(board.title))
  } catch (e) {
    return normalizeError(e)
  }
}

function download(doc: unknown, fileName: string) {
  return new NextResponse(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  })
}
