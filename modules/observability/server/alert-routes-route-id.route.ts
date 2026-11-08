import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertRouteService from './alert.route.service'
import { UpdateRouteDTO } from './alert.dto'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string, routeId: string }> }) {
  try {
    const { tenantId, routeId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await AlertRouteService.update(tenantId, routeId, UpdateRouteDTO.parse(await request.json())) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, routeId: string }> }) {
  try {
    const { tenantId, routeId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    await AlertRouteService.remove(tenantId, routeId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
