import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import IncidentService from './incident.service'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

type Ctx = { params: Promise<{ tenantId: string; incidentId: string }> }

/** POST /api/incidents/{id}/resolve — manually close an incident. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    const item = await IncidentService.resolveById(tenantId, incidentId, user?.userId ?? null)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}
