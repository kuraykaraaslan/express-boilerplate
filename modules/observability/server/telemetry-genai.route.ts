import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { genAiOverview } from './genai/genai.explore'
import { mapTelemetryError, readJsonBody } from './telemetry/telemetry.http'
import { queryDeps } from './telemetry/telemetry.routes.shared'

/** POST /api/telemetry/genai: per-model calls, tokens and conversations of the gen_ai.* spans this workspace sent through OTLP (a sample of recent traces). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await genAiOverview(queryDeps, tenantId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
