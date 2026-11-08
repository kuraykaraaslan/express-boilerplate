import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import SloService from './slo.service'
import { BurnQueryDTO } from './slo.dto'
import { buildBurnSeries } from './slo.burn'

type Ctx = { params: Promise<{ tenantId: string, sloId: string }> }

/**
 * GET /api/slos/{id}/burn?points=N: the series behind the burn chart (burn rate and error budget left over the SLO window, daily from the rollup and
 * hourly from raw checks for the newest hours; each point says its resolution and source) and the current short / long window burn of every tier.
 * Same permission as the SLO detail. `points` is bounded (2 to 200); a missing value means 120, an out-of-range one is a 400.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, sloId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.read', scope: 'TENANT' })
    const query = BurnQueryDTO.parse(Object.fromEntries(request.nextUrl.searchParams))
    const slo = await SloService.getById(tenantId, sloId)
    return NextResponse.json({ burn: await buildBurnSeries(tenantId, slo, query.points) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return normalizeError(e) }
}
