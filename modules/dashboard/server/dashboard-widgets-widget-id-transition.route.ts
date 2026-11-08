import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardWidgetService from './widget.crud.service'
import DashboardWidgetPublishingService from './widget.publishing.service'
import { WidgetTransitionDTO } from './widget.dto'
import { assertCanTransition, type WidgetVisibility } from './widget-authoring.acl'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'

type Ctx = { params: Promise<{ tenantId: string; widgetId: string }> }

/**
 * POST …/dashboard/widgets/[widgetId]/transition — publish, unpublish, archive, restore.
 *
 * One endpoint for the whole state machine rather than four verbs, because the
 * legality of a move depends on the current state and that check belongs in one
 * place. Publishing cuts a version; the others do not touch `publishedVersion`,
 * so archiving stops a widget being offered without yanking it off live boards.
 *
 * K11: entry gate is `author_private` (every USER may run their OWN `PRIVATE`
 * widget through this state machine, publish included — ownership already
 * enforced by `get()` below); a `TENANT` widget's whole state machine keeps
 * needing `dashboard.widgets.publish`, unchanged from before this dilim.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, widgetId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.widgets.author_private',
      alsoCheck: ['dashboard.widgets.publish'],
    })
    const widget = await DashboardWidgetService.get(tenantId, widgetId, { userId: ctx.userId })
    assertCanTransition(widget.visibility as WidgetVisibility, ctx.granted.has('dashboard.widgets.publish'))
    const body = WidgetTransitionDTO.parse(await request.json())

    if (body.action === 'publish') {
      const { changelog, renames, keepOldDefaults } = body
      const result = await DashboardWidgetPublishingService.publish(tenantId, widgetId, { userId: ctx.userId }, changelog ?? null, { renames, keepOldDefaults })
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.widget.publish', resourceType: 'dashboard_widget',
        resourceId: widgetId, metadata: { type: widget.type, settingsTemplate: result.widget.settingsTemplate ?? null },
      })
      return NextResponse.json(result)
    }
    const { action } = body
    const moved = await DashboardWidgetPublishingService.transition(tenantId, widgetId, action, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.widget.transition', resourceType: 'dashboard_widget',
      resourceId: widgetId, metadata: { type: widget.type, action, status: moved.status },
    })
    return NextResponse.json({ widget: moved })
  } catch (e) {
    return normalizeError(e)
  }
}
