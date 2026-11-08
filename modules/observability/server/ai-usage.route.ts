import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { tenantAiUsage } from './genai/genai.usage'

/** GET /api/observability/ai/usage?days=30: tokens and cost of this workspace's model calls (NB's own `ai` usage log), per model and per day. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    return NextResponse.json(await tenantAiUsage(tenantId, Number(request.nextUrl.searchParams.get('days')) || 30))
  } catch (e) { return normalizeError(e) }
}
