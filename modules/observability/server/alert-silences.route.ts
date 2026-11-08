import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertSilenceService from './alert.silence.service'
import { CreateSilenceDTO } from './alert.dto'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    return NextResponse.json({ items: await AlertSilenceService.list(tenantId, { includeExpired: request.nextUrl.searchParams.get('all') === '1' }) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await AlertSilenceService.create(tenantId, CreateSilenceDTO.parse(await request.json()), user?.userId ?? null) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
