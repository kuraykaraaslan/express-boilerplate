import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import CostCenterService from '@kuraykaraaslan-labs/organization/server/organization.cost-center.service'
import { UpdateCostCenterDTO } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

type Ctx = { params: Promise<{ tenantId: string; costCenterId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, costCenterId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.cost_centers.read', scope: 'TENANT' })
    const item = await CostCenterService.getById(tenantId, costCenterId)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, costCenterId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.cost_centers.update', scope: 'TENANT' })
    const dto = UpdateCostCenterDTO.parse(await request.json())
    const item = await CostCenterService.update(tenantId, costCenterId, dto, user.userId)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, costCenterId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.cost_centers.delete', scope: 'TENANT' })
    await CostCenterService.delete(tenantId, costCenterId, user.userId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return normalizeError(e)
  }
}
