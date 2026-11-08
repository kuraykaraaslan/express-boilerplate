import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { incidentAnalytics } from './incident.analytics.service'

/** GET /api/incident-analytics?days=30: MTTA, MTTR, MTBF, counts by severity and component, alert noise. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ analytics: await incidentAnalytics(tenantId, Number(request.nextUrl.searchParams.get('days')) || 30) })
  } catch (e) { return normalizeError(e) }
}
