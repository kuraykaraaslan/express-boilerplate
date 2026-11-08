import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { releaseHealth } from './telemetry.release-health'

type Ctx = { params: Promise<{ tenantId: string }> }

/** POST /api/telemetry/query/release-health: error rate and Core Web Vitals by release, from the metrics the browser snippet sends. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await releaseHealth(queryDeps, tenantId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
