import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusAutomationService from './status.automation.service'

type Ctx = { params: Promise<{ tenantId: string; automationId: string }> }

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, automationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    await StatusAutomationService.remove(tenantId, automationId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
