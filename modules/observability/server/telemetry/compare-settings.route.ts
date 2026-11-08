import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { isCompareEnabled, setCompareEnabled } from './telemetry.compare.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/telemetry/compare/settings: is attribute comparison on for this workspace (default: off). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json({ enabled: await isCompareEnabled(tenantId) })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** PUT /api/telemetry/compare/settings: `{ enabled }`. Audited. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    return NextResponse.json(await setCompareEnabled(tenantId, user.userId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
