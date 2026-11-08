import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import { placementBoardOr404 } from './placement-board'
import DashboardInstanceService from './instance.crud.service'
import DashboardCardOverlayService, { toCardOverlayView } from './card-overlay.service'
import { SetCardOverlayDTO, subjectFromQuery } from './card-overlay.dto'
import { assertSubjectReadable } from './card-overlay.subject'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'

type Ctx = { params: Promise<{ tenantId: string; instanceId: string }> }

/**
 * The card, on a board the caller may write (the same gate as a settings edit of the card). Each method asks for its entry permission
 * itself, so the route matrix (dashboard.routes-authz.security.test.ts) reads it there and attacks it.
 */
async function writableCard(tenantId: string, instanceId: string, ctx: Awaited<ReturnType<typeof dashboardContext>>) {
  const instance = await DashboardInstanceService.get(tenantId, instanceId)
  assertCanWrite(await placementBoardOr404(tenantId, instance, { userId: ctx.userId }), ctx.granted.has('dashboard.boards.manage'))
  return instance
}

/**
 * PUT …/dashboard/instances/[instanceId]/overlays — the card's settings and title for one subject (phase 38, E38-7/E38-8): body
 * `{ subjectType, subjectId, settings, title?, expectedRevision? }`, `settings` a merge patch on the card's own settings, judged as a
 * settings edit of the card; data, actions and visibility are not part of an overlay. 409 when another save came first.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, instanceId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write', alsoCheck: ['dashboard.boards.manage'] })
    const instance = await writableCard(tenantId, instanceId, ctx)
    const dto = SetCardOverlayDTO.parse(await request.json())
    const subject = { type: dto.subjectType, id: dto.subjectId }
    await assertSubjectReadable(request, tenantId, subject, { mustExist: true })
    const { overlay, keys } = await DashboardCardOverlayService.set(tenantId, instance, subject, dto, ctx.userId)
    await DashboardBoardService.touch(tenantId, instance.entityId, { byUserId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.card_overlay.set', resourceType: 'dashboard_card_overlay', resourceId: overlay.overlayId,
      metadata: { boardId: instance.entityId, instanceId, subjectType: subject.type, subjectId: subject.id, keys, revision: overlay.revision },
    })
    return NextResponse.json({ overlay: toCardOverlayView(overlay) })
  } catch (e) {
    return normalizeError(e)
  }
}

/** DELETE …/dashboard/instances/[instanceId]/overlays?subjectType=&subjectId= — the card shows the board's settings for that subject again. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, instanceId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write', alsoCheck: ['dashboard.boards.manage'] })
    const instance = await writableCard(tenantId, instanceId, ctx)
    const subject = subjectFromQuery(request.nextUrl.searchParams)
    if (!subject) throw new AppError('subjectType and subjectId are required', 400, ErrorCode.VALIDATION_ERROR)
    await assertSubjectReadable(request, tenantId, subject)
    const removed = await DashboardCardOverlayService.reset(tenantId, instanceId, subject, ctx.userId)
    if (removed) {
      await DashboardBoardService.touch(tenantId, instance.entityId, { byUserId: ctx.userId })
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.card_overlay.reset', resourceType: 'dashboard_card_overlay', resourceId: instanceId,
        metadata: { boardId: instance.entityId, instanceId, subjectType: subject.type, subjectId: subject.id },
      })
    }
    return NextResponse.json({ ok: true, removed })
  } catch (e) {
    return normalizeError(e)
  }
}
