import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { authorizeOps, runAudited } from './ops/ops.auth'
import IncidentService from './incident.service'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { ListIncidentsQuery } from './incident.dto'
import { z } from 'zod'
import { IncidentSeverityEnum } from './uptime.enums'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/incidents?status=OPEN&monitorId=&sort=&search= — the incident list (phase 43 list contract). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    // The list contract (100 a page, open first, as before): statuses, severities, monitors, a range, a title search.
    // `items` stays beside `data`; an unknown status is a 400 now (it matched nothing before).
    const page = await IncidentService.listPage(tenantId, readListQuery(new URL(request.url).searchParams, ListIncidentsQuery))
    return NextResponse.json({ items: page.data, ...page })
  } catch (e) {
    return normalizeError(e)
  }
}

const DeclareIncidentDTO = z.object({
  title: z.string().trim().min(1).max(300),
  severity: IncidentSeverityEnum.default('MAJOR'),
  reason: z.string().max(1000).nullish(),
})

/** POST /api/incidents: declare an incident by hand. It opens private (like every incident) and starts its own timeline with who declared it. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    // Two lanes: a console session with the permission, or an api key holding exactly observability_ops:incident (ops/ops.auth.ts).
    const who = await authorizeOps(request, tenantId, 'incident', 'observability.incidents.manage')
    const dto = DeclareIncidentDTO.parse(await request.json())
    const userId = who.actor.type === 'USER' ? who.actor.id : null
    // A machine-declared incident says so: nobody typed it, and the key is traceable from the incident (and the audit log).
    const reason = who.lane === 'api_key' ? `${dto.reason ? `${dto.reason} ` : ''}[declared by API key ${(who.actor.id ?? '').slice(0, 8)}]`.slice(0, 1000) : (dto.reason ?? null)
    const item = await runAudited(who, (i: { incidentId: string }) => ({ type: 'incident', id: i.incidentId }), () => IncidentService.openIncident(tenantId, { title: dto.title, severity: dto.severity, reason, isAuto: false, declaredBy: userId }))
    return NextResponse.json({ item }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
