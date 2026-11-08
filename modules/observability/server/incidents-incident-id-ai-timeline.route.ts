import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { incidentAiTimeline } from './genai/genai.conversation'
import { realIncidentTimelineSources } from './genai/genai.conversation.sources'

/**
 * GET /api/incidents/{id}/ai/timeline: the conversation timeline of NB's assistant on this incident: per run the evidence built, the model call
 * with its tokens and (from the `ai` usage log) its cost, the claims kept and dropped by the citation rule, the outcome and feedback, with MCP tool
 * calls on the incident interleaved. Data only; the console keeps its list of runs.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    return NextResponse.json(await incidentAiTimeline(realIncidentTimelineSources, tenantId, incidentId))
  } catch (e) { return normalizeError(e) }
}
