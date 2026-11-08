import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentWorkflowService from './incident.workflow.service'
import { TaskDTO } from './incident.dto'

/** Follow-ups are `tasks` records related to the incident. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ items: await IncidentWorkflowService.listTasks(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    const dto = TaskDTO.parse(await request.json())
    return NextResponse.json(await IncidentWorkflowService.addTask(tenantId, incidentId, dto, user?.userId ?? null), { status: 201 })
  } catch (e) { return normalizeError(e) }
}
