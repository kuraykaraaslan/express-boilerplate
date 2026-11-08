import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService from './board.crud.service'
import { homeOf } from './user-home'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/landing: the board this caller lands on at the admin home (phase 20.2e), or null.
 *
 * In order: the board the caller chose as THEIR home (`dashboard_user_homes`, any standalone board they can open, a shared one
 * included: owner 2026-10-26), then the older form of the same choice (`isDefault` on a personal standalone board), then the tenant's
 * shared home (`isDefault` on a shared one, which needs `dashboard.boards.manage`, like any shared write). A chosen board the caller
 * can no longer open, or one that is no longer standalone, is skipped. `findDefault` only returns boards the caller can open, so a
 * private board of someone else can never be a landing board for this caller. `mine` says the board is the caller's own choice.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const chosen = await homeOf(tenantId, userId)
    const own = chosen ? await DashboardBoardService.get(tenantId, chosen, { userId }).catch(() => null) : null
    if (own && !own.workspace && !own.moduleId) {
      return NextResponse.json({ board: { boardId: own.boardId, title: own.title, scope: own.scope }, mine: true })
    }
    const board = await DashboardBoardService.findDefault(tenantId, { userId }, {})
    return NextResponse.json({
      board: board ? { boardId: board.boardId, title: board.title, scope: board.scope } : null,
      mine: !!board && board.scope === 'PRIVATE',
    })
  } catch (e) {
    return normalizeError(e)
  }
}
