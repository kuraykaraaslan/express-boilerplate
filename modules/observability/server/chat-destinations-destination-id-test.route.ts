import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ChatService from './chat.service'

type Ctx = { params: Promise<{ tenantId: string; destinationId: string }> }

/** Send one fixed, harmless message to the destination. Strictest rate bucket (every call posts to a third party), plus a per-destination cooldown. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, destinationId } = await params
    await Limiter.checkRateLimit(request, 'auth')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.chat.manage', scope: 'TENANT' })
    return NextResponse.json(await ChatService.sendTest(tenantId, destinationId, user?.userId ?? null))
  } catch (e) { return normalizeError(e) }
}
