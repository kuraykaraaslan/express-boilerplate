import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertService from './alert.service'

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, alertId: string }> }) {
  try {
    const { tenantId, alertId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    const current = await AlertService.getById(tenantId, alertId)
    const item = await AlertService.resolve(tenantId, { alertId }) ?? current
    return NextResponse.json({ item })
  } catch (e) { return normalizeError(e) }
}
