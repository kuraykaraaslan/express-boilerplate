import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertIntegrationService from './alert.integration.service'
import { UpdateIntegrationDTO } from './alert.dto'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string, integrationId: string }> }) {
  try {
    const { tenantId, integrationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await AlertIntegrationService.update(tenantId, integrationId, UpdateIntegrationDTO.parse(await request.json())) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, integrationId: string }> }) {
  try {
    const { tenantId, integrationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    await AlertIntegrationService.remove(tenantId, integrationId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
