import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { runView, setFeedback } from './ai/ai.store'
import { readJsonBody } from './telemetry/telemetry.http'

const FeedbackDTO = z.object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) }).strict()

/** POST /api/incidents/{id}/ai/{noteId}/feedback: thumbs up (1), down (-1) or clear (null) on an AI run. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; incidentId: string; noteId: string }> }) {
  try {
    const { tenantId, incidentId, noteId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    const { value } = FeedbackDTO.parse(await readJsonBody(request))
    return NextResponse.json({ item: runView(await setFeedback(tenantId, incidentId, noteId, value, user?.userId ?? null)) })
  } catch (e) { return normalizeError(e) }
}
