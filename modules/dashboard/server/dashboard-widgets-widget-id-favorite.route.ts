import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardWidgetService from './widget.crud.service'
import { WidgetRefSchema } from './dashboard.dto'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; widgetId: string }> }

/**
 * Star / unstar a widget for the CALLER.
 *
 * `widgetId` here is the prefixed ref, so a manifest widget and a tenant-authored
 * one are starred through the same route — the whole reason the reference is
 * prefixed. Only `dashboard.boards.read` is needed: a favourite is a personal
 * bookmark, not a change to anything shared.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, widgetId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const ref = WidgetRefSchema.parse(decodeURIComponent(widgetId))
    await DashboardWidgetService.setFavorite(tenantId, userId, ref, true)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, widgetId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const ref = WidgetRefSchema.parse(decodeURIComponent(widgetId))
    await DashboardWidgetService.setFavorite(tenantId, userId, ref, false)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
