import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { SaveLayoutDTO } from './dashboard.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/**
 * PUT …/dashboard/boards/[boardId]/layout — commit the whole board's geometry.
 *
 * One request, one transaction. A drag reflows neighbouring cards, so the unit of
 * change is the board and not the card; per-card PATCHes would be chatty and, on
 * a partial failure, leave cards overlapping with no way to tell which state the
 * user is looking at. The board's `revision` gates it, so two people arranging the
 * same board get a 409 instead of silently overwriting each other.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const dto = SaveLayoutDTO.parse(await request.json())
    // Write check, revision check, card moves and the revision bump happen on
    // the LOCKED board in one transaction (see DashboardBoardService.saveLayout).
    const { revision } = await DashboardBoardService.saveLayout(
      tenantId, boardId, dto, { userId: ctx.userId },
      (board) => assertCanWrite(board, ctx.granted.has('dashboard.boards.manage')),
    )
    const instances = await DashboardInstanceService.listOnSurface(tenantId, { entityType: 'DASHBOARD', entityId: boardId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.layout', resourceType: 'dashboard_board',
      resourceId: boardId, metadata: { cards: dto.items.length, revision },
    })
    return NextResponse.json({ instances, revision })
  } catch (e) {
    return normalizeError(e)
  }
}
