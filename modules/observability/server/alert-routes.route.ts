import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertRouteService from './alert.route.service'
import { CreateRouteDTO } from './alert.dto'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    return NextResponse.json({ items: await AlertRouteService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await AlertRouteService.create(tenantId, CreateRouteDTO.parse(await request.json())) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
