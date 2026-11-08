import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentLegalHoldService from './incident.legal-hold.service'

/** PUT /api/incidents/{incidentId}/legal-hold  body { held: boolean, reason?: string }: put an incident on, or release it from, a legal hold. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.hold', scope: 'TENANT' })
    const body = await request.json().catch(() => { throw new SyntaxError('invalid JSON') })
    const item = await IncidentLegalHoldService.set(tenantId, incidentId, user?.userId ?? null, body)
    return NextResponse.json({ item: { incidentId: item.incidentId, legalHold: item.legalHold, legalHoldReason: item.legalHoldReason ?? null, legalHoldAt: item.legalHoldAt ?? null } })
  } catch (e) { return normalizeError(e) }
}
