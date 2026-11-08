import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { computeLatencySli } from './slo'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET /api/slo[?route=/api/…] — this process's request-latency percentiles and error ratio since boot. ROOT tenant only: the histogram is process-wide
 * (every tenant's traffic), so it is a platform view, not a tenant one. `enabled:false` when METRICS_ENABLED is off.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    if (!isRootTenant(tenantId)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slo.read', scope: 'TENANT' })
    const route = new URL(request.url).searchParams.get('route') || undefined
    const sli = await computeLatencySli(route)
    return NextResponse.json({ enabled: sli !== null, sli })
  } catch (e) { return normalizeError(e) }
}
