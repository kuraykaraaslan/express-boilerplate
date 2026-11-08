import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ChatService from './chat.service'
import { CreateChatDestinationDTO } from './chat.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** The Slack / Teams destinations of the tenant, as masked views: the host and the settings, never the webhook URL. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    return NextResponse.json({ items: await ChatService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/** Connect a destination. The URL is write-only: it is checked against the vendors' hosts, stored encrypted and never returned. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.chat.manage', scope: 'TENANT' })
    const dto = CreateChatDestinationDTO.parse(await request.json())
    return NextResponse.json({ item: await ChatService.create(tenantId, dto, user?.userId ?? null) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
