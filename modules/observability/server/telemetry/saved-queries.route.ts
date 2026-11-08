import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { createSavedQuery, listSavedQueries } from './telemetry.saved-queries'

type Ctx = { params: Promise<{ tenantId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json({ items: await listSavedQueries(tenantId) })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await createSavedQuery(tenantId, user.userId, await readJsonBody(request)) }, { status: 201 })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
