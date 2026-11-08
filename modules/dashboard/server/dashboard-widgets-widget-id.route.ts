import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardWidgetService from './widget.crud.service'
import DashboardWidgetPublishingService from './widget.publishing.service'
import { UpdateWidgetDTO } from './widget.dto'
import { assertCanAuthor, type WidgetVisibility } from './widget-authoring.acl'
import { assertWritableCategory } from './widget-category.registry'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { assertWidgetHeadroom } from './widget.entitlement'

type Ctx = { params: Promise<{ tenantId: string; widgetId: string }> }

/** GET …/dashboard/widgets/[widgetId] — a definition, its versions and next moves. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, widgetId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const widget = await DashboardWidgetService.get(tenantId, widgetId, { userId })
    return NextResponse.json({
      widget,
      versions: await DashboardWidgetPublishingService.listVersions(tenantId, widgetId, { userId }),
      // The UI renders its buttons from this rather than re-deriving the state
      // machine, which is how the two stay in step.
      actions: DashboardWidgetPublishingService.availableActions(widget.status),
    })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * PATCH …/dashboard/widgets/[widgetId] — edit the draft of the next version.
 *
 * K11: entry gate is `author_private` (every USER may edit their OWN
 * `PRIVATE` widget — ownership already enforced by `get()` below, the same
 * way a board's `PATCH` relies on it); `assertCanAuthor` then decides whether
 * THIS caller may touch a widget that IS, or is BECOMING, `TENANT`.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, widgetId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.widgets.author_private',
      alsoCheck: ['dashboard.widgets.author'],
    })
    const widget = await DashboardWidgetService.get(tenantId, widgetId, { userId: ctx.userId })
    const body = await request.json()
    const dto = UpdateWidgetDTO.parse(body)
    // Only a CHANGED category is checked: a row holding a legacy value stays editable.
    if (dto.category !== undefined && dto.category !== widget.category) {
      await assertWritableCategory(dto.category, tenantId)
    }
    assertCanAuthor(
      widget.visibility as WidgetVisibility,
      dto.visibility as WidgetVisibility | undefined,
      ctx.granted.has('dashboard.widgets.author'),
    )
    // A visibility change moves the widget into the other budget, so it must have room there:
    // otherwise PRIVATE-then-share would walk past the shared plan limit.
    if (dto.visibility !== undefined && dto.visibility !== widget.visibility) {
      await assertWidgetHeadroom(tenantId, dto.visibility, ctx.userId)
    }
    const updated = await DashboardWidgetService.update(tenantId, widgetId, dto, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.widget.update', resourceType: 'dashboard_widget',
      resourceId: widgetId, metadata: { type: widget.type, changed: changedKeys(body) },
    })
    return NextResponse.json({ widget: updated })
  } catch (e) {
    return normalizeError(e)
  }
}

/** DELETE …/dashboard/widgets/[widgetId] — refused while boards still carry it. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, widgetId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.widgets.author_private',
      alsoCheck: ['dashboard.widgets.author'],
    })
    const widget = await DashboardWidgetService.get(tenantId, widgetId, { userId: ctx.userId })
    assertCanAuthor(widget.visibility as WidgetVisibility, undefined, ctx.granted.has('dashboard.widgets.author'))
    await DashboardWidgetService.remove(tenantId, widgetId, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.widget.delete', resourceType: 'dashboard_widget',
      resourceId: widgetId, metadata: { type: widget.type },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
