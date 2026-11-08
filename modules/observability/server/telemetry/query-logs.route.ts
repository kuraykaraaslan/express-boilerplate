import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { queryLogs } from './telemetry.query.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/** POST /api/telemetry/query/logs: a structured log query (never raw LogQL), scoped to the URL workspace. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await queryLogs(queryDeps, tenantId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
