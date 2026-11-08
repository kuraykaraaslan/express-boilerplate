import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusSubscriberService from './status.subscriber.service'
import { subscriberAdminView } from './status.subscriber.view'

type Ctx = { params: Promise<{ tenantId: string }> }

/** Admin view of the subscriber list (tokens are NOT serialized — they are
 *  the subscribers' credentials, not the operator's data). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    const rows = await StatusSubscriberService.list(tenantId)
    // `?detail=1` adds the channel, a masked number, the endpoint HOST and the page / language preference (phase 15.5). The plain list
    // keeps its original five fields for the screen that already reads it. Neither carries a token, a signing key or a full URL.
    const detail = new URL(request.url).searchParams.get('detail') === '1'
    const items = rows.map((s) => detail ? subscriberAdminView(s) : ({
      subscriberId: s.subscriberId,
      email: s.email,
      verifiedAt: s.verifiedAt ?? null,
      componentIds: s.componentIds ?? null,
      createdAt: s.createdAt,
    }))
    return NextResponse.json({ items })
  } catch (e) { return normalizeError(e) }
}
