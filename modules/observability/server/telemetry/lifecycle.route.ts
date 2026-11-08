import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { requireBackend } from './telemetry.http'
import { eraseTenantData, getLifecycle, setRetention } from './telemetry.lifecycle'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/telemetry/lifecycle: the backend's capabilities (what can be set or erased per workspace) and the retention last requested. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json(await getLifecycle(requireBackend(), tenantId))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** PUT /api/telemetry/lifecycle: request a per-workspace retention. 501 when the backend can only retain globally. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    return NextResponse.json(await setRetention(requireBackend(), tenantId, user.userId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** DELETE /api/telemetry/lifecycle: erase this workspace's telemetry. Body: { confirm: <workspace id>, signals?: [...] }. OWNER only; audited. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.erase', scope: 'TENANT' })
    return NextResponse.json(await eraseTenantData(requireBackend(), tenantId, user.userId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
