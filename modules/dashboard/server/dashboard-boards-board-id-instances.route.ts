import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolvePlacedWidgets, assertWidgetPlaceable } from './widget-catalog.service'
import { CreateInstanceDTO } from './dashboard.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import MSG from './dashboard.messages'
import { assertCommandAuthoring } from './command.service'
import { elementAuthoringFor } from './element-authoring'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/**
 * POST …/dashboard/boards/[boardId]/instances — place a widget on the board.
 *
 * The widget is re-resolved for THIS caller before it is stored. Without that,
 * anyone who can edit a board could place a widget they are not allowed to see
 * and read its data through the board — the permission check on render would pass
 * for other viewers who do hold it, and the placer would have laundered access to
 * a surface they could then share. Placement is an authorization decision, not
 * just a write.
 *
 * Two more checks, both Faz 9: `assertCanWrite` (K3 — a TENANT board needs
 * `dashboard.boards.manage`) and `assertWidgetPlaceable` (K10 — a PRIVATE
 * widget cannot land on a TENANT board, where it would resolve for its owner
 * and silently drop out for everyone else the board is shared with).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    assertCanWrite(board, ctx.granted.has('dashboard.boards.manage'))
    const dto = CreateInstanceDTO.parse(await request.json())
    await assertCommandAuthoring(request, tenantId, dto.actions) // only a command the author could run themselves

    const resolved = await resolvePlacedWidgets({
      request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      refs: [dto.widgetRef],
      includeUnavailable: true, // a kind whose module is off: the board draws it inert, a create answers 422 (`dashboard:widget_kinds`)
    })
    const descriptor = resolved.get(dto.widgetRef)
    if (!descriptor) {
      throw new AppError(MSG.WIDGET_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
    }
    assertWidgetPlaceable(board, descriptor)

    const instance = await DashboardInstanceService.create(
      tenantId, { entityType: 'DASHBOARD', entityId: board.boardId }, dto,
      { authoring: elementAuthoringFor(request, tenantId, ctx.session), byUserId: ctx.userId }, // a command on a symbol may need a module permission (`dashboard:element_actions`)
    )
    await DashboardBoardService.touch(tenantId, board.boardId, { byUserId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.placement.create', resourceType: 'dashboard_placement',
      resourceId: instance.instanceId, metadata: { boardId: board.boardId, widgetRef: dto.widgetRef },
    })
    return NextResponse.json({ instance }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
