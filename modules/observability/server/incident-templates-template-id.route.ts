import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentTemplateService from './incident.templates.service'

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, templateId: string }> }) {
  try {
    const { tenantId, templateId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    await IncidentTemplateService.remove(tenantId, templateId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
