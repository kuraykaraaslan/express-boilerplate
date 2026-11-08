import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { authorizeOps, runAudited } from './ops/ops.auth'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentWorkflowService from './incident.workflow.service'
import { NoteDTO } from './incident.dto'

/** Notes are `comments` records on the incident: internal, never on the status page. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ items: await IncidentWorkflowService.listNotes(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    // Two lanes: a console session with the permission, or an api key holding exactly observability_ops:note (ops/ops.auth.ts).
    const who = await authorizeOps(request, tenantId, 'note', 'observability.incidents.manage')
    const dto = NoteDTO.parse(await request.json())
    const userId = who.actor.type === 'USER' ? who.actor.id : null
    const authorName = who.lane === 'api_key' ? `API key ${(who.actor.id ?? '').slice(0, 8)}` : undefined
    return NextResponse.json(await runAudited(who, { type: 'incident', id: incidentId }, () => IncidentWorkflowService.addNote(tenantId, incidentId, dto.content, userId, authorName)), { status: 201 })
  } catch (e) { return normalizeError(e) }
}
