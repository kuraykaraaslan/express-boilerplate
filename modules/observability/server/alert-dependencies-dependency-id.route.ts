import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertDependencyService from './alert.dependency.service'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, dependencyId: string }> }) {
  try {
    const { tenantId, dependencyId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    await AlertDependencyService.remove(tenantId, dependencyId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
