import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { draftStatusUpdate } from './ai/ai.drafts'
import { realDraftDeps } from './ai/ai.routes.shared'
import { readJsonBody } from './telemetry/telemetry.http'

/** POST /api/incidents/{id}/ai/status-draft: a draft of a status update. It is RETURNED, never posted: a person copies it into the update box. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    return NextResponse.json(await draftStatusUpdate(realDraftDeps(), tenantId, incidentId, await readJsonBody(request), { actorId: user?.userId ?? null }))
  } catch (e) { return normalizeError(e) }
}
