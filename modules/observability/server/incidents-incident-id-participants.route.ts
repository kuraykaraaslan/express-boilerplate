import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentParticipantService from './incident.participants.service'
import { AssignRoleDTO } from './incident.dto'
import { z } from 'zod'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ items: await IncidentParticipantService.list(tenantId, incidentId) })
  } catch (e) { return normalizeError(e) }
}

/** PUT assigns or changes a role; handing the command to someone else moves the previous commander to responder. */

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    const dto = AssignRoleDTO.parse(await request.json())
    return NextResponse.json({ item: await IncidentParticipantService.assign(tenantId, incidentId, dto.userId, dto.role, user?.userId ?? null) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    const userId = z.string().uuid().parse(request.nextUrl.searchParams.get('userId'))
    await IncidentParticipantService.remove(tenantId, incidentId, userId, user?.userId ?? null)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
