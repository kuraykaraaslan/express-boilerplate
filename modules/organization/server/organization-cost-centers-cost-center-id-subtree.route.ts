import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import CostCenterService from '@kuraykaraaslan-labs/organization/server/organization.cost-center.service'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

type Ctx = { params: Promise<{ tenantId: string; costCenterId: string }> }

/** The node plus every descendant, depth-first — one materialised-path scan. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, costCenterId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.cost_centers.read', scope: 'TENANT' })
    const data = await CostCenterService.subtree(tenantId, costCenterId)
    return NextResponse.json({ data, total: data.length })
  } catch (e) {
    return normalizeError(e)
  }
}
