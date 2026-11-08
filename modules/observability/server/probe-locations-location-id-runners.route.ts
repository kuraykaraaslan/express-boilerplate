import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeRunnerService from './probe.runner.service'
import ProbeLocationService from './probe.location.service'
import { shedStatsFor } from './probe.shed'

type Ctx = { params: Promise<{ tenantId: string; locationId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, locationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.read', scope: 'TENANT' })
    await ProbeLocationService.getRow(tenantId, locationId)
    // `shed`: due checks this location's polls did not lease because a lease cap was hit (they stay due), kept a week; zeros when no cap ever bit.
    return NextResponse.json({ items: await ProbeRunnerService.list(tenantId, locationId), shed: await shedStatsFor(locationId) })
  } catch (e) { return normalizeError(e) }
}
