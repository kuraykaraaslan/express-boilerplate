import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { assertModuleReachable } from './board.crud.service'
import { resolveModuleWidgets, widgetLabelModules } from './widget-catalog.service'
import { requestLabelTexts } from './contributed-label-texts'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; moduleId: string }> }

/**
 * GET …/dashboard/modules/[moduleId]/widgets/resolve — the widgets this
 * caller may see on that module's board, already permission-filtered. The
 * module-board twin of `dashboard-widgets-resolve.route.ts`.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    assertModuleReachable(moduleId, ctx.enabledIds)
    const widgets = await resolveModuleWidgets({
      request, tenantId, session: ctx.session, moduleId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      // D551: the widgets' names in the workspace's language
      labels: await requestLabelTexts(request, tenantId, widgetLabelModules()),
    })
    return NextResponse.json({ widgets })
  } catch (e) {
    return normalizeError(e)
  }
}
