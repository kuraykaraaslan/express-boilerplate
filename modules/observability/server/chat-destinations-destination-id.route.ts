import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ChatService from './chat.service'
import { UpdateChatDestinationDTO } from './chat.dto'

type Ctx = { params: Promise<{ tenantId: string; destinationId: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, destinationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.chat.manage', scope: 'TENANT' })
    const dto = UpdateChatDestinationDTO.parse(await request.json())
    return NextResponse.json({ item: await ChatService.update(tenantId, destinationId, dto, user?.userId ?? null) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, destinationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.chat.manage', scope: 'TENANT' })
    await ChatService.remove(tenantId, destinationId, user?.userId ?? null)
    return NextResponse.json({ success: true })
  } catch (e) { return normalizeError(e) }
}
