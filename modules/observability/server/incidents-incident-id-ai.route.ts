import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { investigate } from './ai/ai.investigator'
import { listRuns, runView } from './ai/ai.store'
import { realInvestigatorDeps } from './ai/ai.routes.shared'

type Ctx = { params: Promise<{ tenantId: string; incidentId: string }> }

/** GET /api/incidents/{id}/ai: the AI runs recorded for this incident (analyses and drafts), newest first. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    return NextResponse.json({ items: (await listRuns(tenantId, incidentId)).map(runView) })
  } catch (e) { return normalizeError(e) }
}

/** POST: ask the investigator to analyse the incident now. Advisory: nothing is applied. 403 when AI is off for the workspace. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    return NextResponse.json({ item: await investigate(realInvestigatorDeps(), tenantId, incidentId, { trigger: 'MANUAL', actorId: user?.userId ?? null }) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
