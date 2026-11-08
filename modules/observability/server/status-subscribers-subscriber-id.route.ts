import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusSubscriberService from './status.subscriber.service'

type Ctx = { params: Promise<{ tenantId: string; subscriberId: string }> }

/** Remove a subscriber (an operator's hygiene action; a subscriber's own way out is the unsubscribe link in every message). */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, subscriberId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    await StatusSubscriberService.remove(tenantId, subscriberId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
