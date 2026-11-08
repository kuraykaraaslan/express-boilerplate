import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertIntegrationService from './alert.integration.service'

/** A new key; the old one stops working at once. Returned once. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, integrationId: string }> }) {
  try {
    const { tenantId, integrationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    const { integration, key } = await AlertIntegrationService.rotate(tenantId, integrationId)
    return NextResponse.json({ item: integration, key })
  } catch (e) { return normalizeError(e) }
}
