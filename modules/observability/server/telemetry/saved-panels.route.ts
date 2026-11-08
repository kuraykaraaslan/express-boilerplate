import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { createSavedPanel, listSavedPanels } from './telemetry.saved-panels'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/telemetry/saved-panels: this workspace's saved metric panels. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    return NextResponse.json({ items: await listSavedPanels(tenantId) })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}

/** POST /api/telemetry/saved-panels: save a structured metric query (no range) and the range and exemplar choice it opens with. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await createSavedPanel(tenantId, user.userId, await readJsonBody(request)) }, { status: 201 })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
