import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import { placementBoardOr404 } from './placement-board'
import DashboardInstanceService from './instance.crud.service'
import { UpdateInstanceDTO } from './dashboard.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { assertCommandAuthoring } from './command.service'
import { elementAuthoringFor } from './element-authoring'

type Ctx = { params: Promise<{ tenantId: string; instanceId: string }> }

/**
 * Re-check the board through the viewer-aware getter before touching a placement,
 * and (Faz 9, K3) refuse it unless the caller may write THAT board.
 *
 * The instance row carries only a bare `entityId` — that is what makes the surface
 * seam polymorphic — so nothing in the row itself says whether this caller may
 * open the board it sits on. Loading the board is what enforces "someone else's
 * private dashboard is a 404" (worded as a missing placement, dashboard.10);
 * `assertCanWrite` is what enforces "a TENANT board needs `dashboard.boards.manage`".
 * A placement on any other surface (`entityType` other than `'DASHBOARD'`) is a 404:
 * this module does not know that surface's write rule, so it fails closed (dashboard.08).
 */
async function assertOnVisibleBoard(tenantId: string, instanceId: string, userId: string, hasManage: boolean) {
  const instance = await DashboardInstanceService.get(tenantId, instanceId)
  assertCanWrite(await placementBoardOr404(tenantId, instance, { userId }), hasManage)
  return instance
}

/** PATCH …/dashboard/instances/[instanceId] — settings, title, refresh, geometry. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, instanceId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const hasManage = ctx.granted.has('dashboard.boards.manage')
    const instance = await assertOnVisibleBoard(tenantId, instanceId, ctx.userId, hasManage)
    const dto = UpdateInstanceDTO.parse(await request.json())
    await assertCommandAuthoring(request, tenantId, dto.actions) // only a command the author could run themselves
    const updated = await DashboardInstanceService.update(tenantId, instanceId, dto, { authoring: elementAuthoringFor(request, tenantId, ctx.session), byUserId: ctx.userId })
    await DashboardBoardService.touch(tenantId, instance.entityId, { byUserId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.placement.update', resourceType: 'dashboard_placement',
      resourceId: instanceId, metadata: { boardId: instance.entityId, fields: changedKeys(dto) },
    })
    return NextResponse.json({ instance: updated })
  } catch (e) {
    return normalizeError(e)
  }
}

/** DELETE …/dashboard/instances/[instanceId] — remove one placement. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, instanceId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const hasManage = ctx.granted.has('dashboard.boards.manage')
    const instance = await assertOnVisibleBoard(tenantId, instanceId, ctx.userId, hasManage)
    await DashboardInstanceService.remove(tenantId, instanceId, { byUserId: ctx.userId })
    await DashboardBoardService.touch(tenantId, instance.entityId, { byUserId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.placement.delete', resourceType: 'dashboard_placement',
      resourceId: instanceId, metadata: { boardId: instance.entityId, widgetRef: instance.widgetRef },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
