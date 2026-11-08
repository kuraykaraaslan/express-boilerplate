import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusGroupService, { CreateStatusGroupDTO } from './status.group.service'

type Ctx = { params: Promise<{ tenantId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    return NextResponse.json({ items: await StatusGroupService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const dto = CreateStatusGroupDTO.parse(await request.json())
    return NextResponse.json({ item: await StatusGroupService.create(tenantId, dto) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
