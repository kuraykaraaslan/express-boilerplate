import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import UptimeService from './uptime.uptime.service'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string }> }

/** GET …/monitors/{id}/uptime?days=30 — availability % over a window. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    const days = Math.min(365, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30))
    const to = new Date()
    const from = new Date(to.getTime() - days * 86_400_000)
    return NextResponse.json({ uptime: await UptimeService.uptime(tenantId, monitorId, { from, to }) })
  } catch (e) { return normalizeError(e) }
}
