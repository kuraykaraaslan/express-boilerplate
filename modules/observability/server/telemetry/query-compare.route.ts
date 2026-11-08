import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { compare, isCompareEnabled } from './telemetry.compare.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST /api/telemetry/query/compare: which attribute best separates failing request spans from the baseline, over a bounded sample of recent
 * traces. 409 `attribute_comparison_off` until a workspace admin switches it on (`PUT /api/telemetry/compare/settings`).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await compare({ ...queryDeps, enabled: isCompareEnabled }, tenantId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
