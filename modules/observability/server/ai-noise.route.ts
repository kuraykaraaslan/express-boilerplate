import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { noiseSuggestions } from './ai/ai.noise.service'

/** GET /api/observability/ai/noise?days=14: suggestions for making the alert pipeline quieter. Offline analysis, no model; nothing is applied. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.ai.use', scope: 'TENANT' })
    const days = Number(request.nextUrl.searchParams.get('days')) || 14
    return NextResponse.json(await noiseSuggestions(tenantId, days))
  } catch (e) { return normalizeError(e) }
}
