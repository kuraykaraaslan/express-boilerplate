import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertRouteService from './alert.route.service'
import { SimulateRouteDTO } from './alert.dto'

/** POST /api/alert-routes/simulate: where would an alert with these labels go? Writes nothing. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    return NextResponse.json({ decision: await AlertRouteService.simulate(tenantId, SimulateRouteDTO.parse(await request.json())) })
  } catch (e) { return normalizeError(e) }
}
