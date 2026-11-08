import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import IncidentPostmortemService from './incident.postmortem.service'
import { ReviewDTO } from './incident.dto'

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.manage', scope: 'TENANT' })
    const dto = ReviewDTO.parse(await request.json())
    return NextResponse.json({ item: await IncidentPostmortemService.submitForReview(tenantId, incidentId, dto.reviewerUserId, user?.userId ?? null) })
  } catch (e) { return normalizeError(e) }
}
