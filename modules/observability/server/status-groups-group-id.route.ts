import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusGroupService, { UpdateStatusGroupDTO } from './status.group.service'

type Ctx = { params: Promise<{ tenantId: string; groupId: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, groupId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const dto = UpdateStatusGroupDTO.parse(await request.json())
    return NextResponse.json({ item: await StatusGroupService.update(tenantId, groupId, dto) })
  } catch (e) { return normalizeError(e) }
}

/** Deleting a group ungroups its components; none of them is deleted. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, groupId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    await StatusGroupService.remove(tenantId, groupId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
