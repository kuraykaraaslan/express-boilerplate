import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { getAiSettings, updateAiSettings } from './ai/ai.settings'
import { readJsonBody } from './telemetry/telemetry.http'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/observability/ai/settings: the workspace's AI switches (everything is off until an admin turns it on). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    return NextResponse.json({ settings: await getAiSettings(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/** PUT: change the switches, the daily cap and the provider allow-list. A strict patch: an unknown key is a 400. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.manage', scope: 'TENANT' })
    return NextResponse.json({ settings: await updateAiSettings(tenantId, await readJsonBody(request), user?.userId) })
  } catch (e) { return normalizeError(e) }
}
