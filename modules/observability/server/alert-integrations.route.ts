import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertIntegrationService from './alert.integration.service'
import { CreateIntegrationDTO } from './alert.dto'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    return NextResponse.json({ items: await AlertIntegrationService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/** The key is in this response and nowhere else, ever. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    const { integration, key } = await AlertIntegrationService.create(tenantId, CreateIntegrationDTO.parse(await request.json()))
    return NextResponse.json({ item: integration, key }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
