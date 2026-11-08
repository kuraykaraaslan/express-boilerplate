import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { listMetricNames, queryMetrics } from './telemetry.query.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/telemetry/query/metrics?fromMs=&toMs=: the metric names this workspace has written in the window (the metrics browser). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    const sp = new URL(request.url).searchParams
    return NextResponse.json(await listMetricNames(queryDeps, tenantId, { fromMs: Number(sp.get('fromMs')), toMs: Number(sp.get('toMs')) }))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** POST /api/telemetry/query/metrics: a structured metric query (metric, aggregation, group by, filters), never raw PromQL. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await queryMetrics(queryDeps, tenantId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
