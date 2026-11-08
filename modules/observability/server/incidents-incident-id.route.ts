import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentService from './incident.service'
import { UpdateIncidentDTO } from './uptime.dto'

type Ctx = { params: Promise<{ tenantId: string; incidentId: string }> }

/** One incident (phase 21.2: REST completeness). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ item: await IncidentService.getById(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}

/** Edit an incident's public face: publish (isPublic), the customer-facing
 *  message, severity, affected components. Auto-opened incidents stay private
 *  until an operator flips isPublic here. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    // The body is parsed BEFORE authorization (no side effects there) because
    // it decides which permission applies: touching `isPublic` is an
    // outward-facing act — customers and subscribers see the result — so it
    // takes the separate, narrower `observability.status.publish` (phase 4); so
    // does flagging a private incident for a restricted page (`audiencePageIds`),
    // because the members of that audience read it;
    // everything else is ordinary incident bookkeeping.
    // observability.05: the permission is picked from the raw keys and the caller is authorized BEFORE the body is
    // validated, so an anonymous or unauthorized caller never sees validation details.
    const raw: unknown = await request.json().catch(() => null)
    const has = (k: string) => !!raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, k) && (raw as Record<string, unknown>)[k] !== undefined
    const requiredPermission = has('isPublic') || has('audiencePageIds')
      ? 'observability.status.publish'
      : 'observability.incidents.manage'
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission, scope: 'TENANT' })
    const dto = UpdateIncidentDTO.parse(raw)
    return NextResponse.json({ item: await IncidentService.updateIncident(tenantId, incidentId, dto, user?.userId ?? null) })
  } catch (e) { return normalizeError(e) }
}
