import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentService from './incident.service'
import { AddIncidentUpdateDTO } from './uptime.dto'

type Ctx = { params: Promise<{ tenantId: string; incidentId: string }> }

/** The incident's public progress steps (state-machine history, oldest
 *  first). POSTing a RESOLVED step also resolves the incident itself. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    return NextResponse.json({ items: await IncidentService.listUpdates(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    const dto = AddIncidentUpdateDTO.parse(await request.json())
    return NextResponse.json({ item: await IncidentService.addUpdate(tenantId, incidentId, dto, user?.userId ?? null) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
