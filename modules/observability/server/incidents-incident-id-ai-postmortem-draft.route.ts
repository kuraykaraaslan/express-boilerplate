import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { draftPostmortem } from './ai/ai.drafts'
import { realPostmortemDeps } from './ai/ai.routes.shared'

/**
 * POST /api/incidents/{id}/ai/postmortem-draft: fill the EMPTY sections of the incident's draft post-mortem from the cited analysis. Needs the AI
 * permission AND the permission to manage incidents (it writes into the post-mortem). Human text is never overwritten; nothing is submitted or published.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    return NextResponse.json(await draftPostmortem(realPostmortemDeps(), tenantId, incidentId, { actorId: user?.userId ?? null }))
  } catch (e) { return normalizeError(e) }
}
