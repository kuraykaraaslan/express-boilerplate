import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { getTrace } from './telemetry.query.service'

type Ctx = { params: Promise<{ tenantId: string; traceId: string }> }

/** GET /api/telemetry/query/traces/[traceId]: one trace as a span tree. A trace of another workspace answers 404, same as a missing one. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, traceId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await getTrace(queryDeps, tenantId, traceId))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
