import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import WidgetTransferService, { parseWidgetPackage } from './widget.transfer.service'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * `GET …/dashboard/widgets/transfer` — export the tenant's portable widgets.
 *
 * `dashboard.widgets.author` rather than `boards.read`: a package carries the
 * templates and schemas somebody wrote, so reading a dashboard is not enough
 * standing to walk off with the widget library behind it.
 *
 * The response names what it left out (`skipped`) rather than quietly
 * shipping fewer widgets than the tenant has — an operator restoring a backup
 * needs to know a component-tier widget was never in it.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.widgets.author' })
    return NextResponse.json(await WidgetTransferService.exportWidgets(tenantId, { userId }))
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * `POST …/dashboard/widgets/transfer?overwrite=true` — apply a package.
 *
 * Imported widgets arrive as DRAFT whatever the package says, so publishing
 * stays a decision made in this tenant. `overwrite` defaults to FALSE: an
 * existing type is reported in `skipped` instead of being replaced, because a
 * widget holds a tenant's own layout work and the safe direction for a
 * destructive default is to refuse and say so.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.widgets.author' })
    const overwrite = new URL(request.url).searchParams.get('overwrite') === 'true'
    const pkg = parseWidgetPackage(await request.json().catch(() => null))
    const result = await WidgetTransferService.importWidgets(tenantId, pkg, { overwrite, userId })
    // One row per import, not per widget: a 500-widget package is one act. The resource id is the tenant.
    if (result.created || result.updated) {
      await auditBoardWrite({
        tenantId, userId, action: 'dashboard.widget.import', resourceType: 'dashboard_widget',
        resourceId: tenantId, metadata: { overwrite, created: result.created, updated: result.updated, skipped: result.skipped.length, notes: result.notes.length },
      })
    }
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return normalizeError(e)
  }
}
