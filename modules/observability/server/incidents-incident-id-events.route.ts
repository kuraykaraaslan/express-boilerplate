import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { listIncidentEvents } from './incident.timeline.service'

/** GET /api/incidents/{id}/events: the internal timeline, oldest first. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ items: await listIncidentEvents(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}
