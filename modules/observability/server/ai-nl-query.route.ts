import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { askTelemetry } from './ai/ai.nlquery'
import { realNlDeps } from './ai/ai.routes.shared'
import { mapTelemetryError, readJsonBody } from './telemetry/telemetry.http'

/** POST /api/observability/ai/query: a question becomes a STRUCTURED query (never backend syntax), validated, run for this workspace and shown with its results. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await askTelemetry(realNlDeps(), tenantId, await readJsonBody(request), { actorId: user?.userId ?? null }))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
