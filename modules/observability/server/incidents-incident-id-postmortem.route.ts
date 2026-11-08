import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentPostmortemService, { UpdatePostmortemDTO } from './incident.postmortem.service'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ item: await IncidentPostmortemService.get(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}

/** POST makes the draft (or returns the existing one) from the incident's own timeline. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await IncidentPostmortemService.createDraft(tenantId, incidentId, user?.userId ?? null) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await IncidentPostmortemService.update(tenantId, incidentId, UpdatePostmortemDTO.parse(await request.json())) })
  } catch (e) { return normalizeError(e) }
}
