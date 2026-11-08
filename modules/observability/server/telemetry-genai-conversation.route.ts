import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { loadAiPeer } from './peers/peers'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { CONVERSATION_ID, genAiConversation, type PriceFn } from './genai/genai.conversation'
import { mapTelemetryError } from './telemetry/telemetry.http'
import { queryDeps } from './telemetry/telemetry.routes.shared'

/**
 * GET /api/telemetry/genai/conversations/{conversationId}?lookbackMinutes=1440: the timeline of one conversation of a tenant application
 * (`gen_ai.conversation.id`, ingested through OTLP): model calls, embeddings, agent invocations, tool executions and retrievals in order, with
 * tokens, errors and an ESTIMATED cost. A sample of the most recent traces that carry the id; another workspace's conversation is the same empty answer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; conversationId: string }> }) {
  try {
    const { tenantId, conversationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    if (!CONVERSATION_ID.test(conversationId)) throw new AppError('Invalid conversation id', 400, ErrorCode.VALIDATION_ERROR)
    const lookback = Math.min(10_080, Math.max(1, Number(request.nextUrl.searchParams.get('lookbackMinutes')) || 1440))
    const toMs = Date.now()
    // The price table of `ai` (the one its own usage log is priced with). No price, or no `ai`: an unknown cost, never zero.
    const priced = await loadAiPeer(tenantId)
    const price: PriceFn = (model, i, o) => priced?.calcCostUsd(model, i, o)
    return NextResponse.json(await genAiConversation(queryDeps, tenantId, conversationId, { range: { fromMs: toMs - lookback * 60_000, toMs } }, price))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
