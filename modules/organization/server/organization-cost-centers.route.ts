import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import CostCenterService from '@kuraykaraaslan-labs/organization/server/organization.cost-center.service'
import { CreateCostCenterDTO, GetCostCentersQuery } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.cost_centers.read', scope: 'TENANT' })
    const query = readListQuery(new URL(request.url).searchParams, GetCostCentersQuery)
    const { data, total } = await CostCenterService.list(tenantId, query)
    return NextResponse.json({ data, total })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.cost_centers.create', scope: 'TENANT' })
    const dto = CreateCostCenterDTO.parse(await request.json())
    const item = await CostCenterService.create(tenantId, dto, user.userId)
    return NextResponse.json({ item }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
