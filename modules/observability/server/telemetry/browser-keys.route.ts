import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { listBrowserKeys, removeBrowserKey, setBrowserKey } from './telemetry.browser-keys'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/telemetry/browser-keys: the Origin allow-list and rate limit of each browser ingest key of this workspace. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json({ items: await listBrowserKeys(tenantId) })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** PUT /api/telemetry/browser-keys: `{ apiKeyId, origins, ratePerMinute? }` allow-lists the origins of one browser key. Audited. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await setBrowserKey(tenantId, user.userId, await readJsonBody(request)) })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** DELETE /api/telemetry/browser-keys?apiKeyId=...: forget the configuration; the key is then refused at ingest. Audited. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    const apiKeyId = request.nextUrl.searchParams.get('apiKeyId') ?? ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apiKeyId)) throw new AppError('apiKeyId must be a key id', 400, ErrorCode.VALIDATION_ERROR)
    if (!(await removeBrowserKey(tenantId, user.userId, apiKeyId))) throw new AppError('No browser configuration for this key', 404, ErrorCode.NOT_FOUND)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
