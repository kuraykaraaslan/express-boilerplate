import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import MonitorService from './uptime.monitor.service'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string }> }

/** POST …/monitors/{id}/check — probe now ("test now" button). */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    return NextResponse.json({ result: await MonitorService.probeAndRecord(tenantId, monitorId) })
  } catch (e) { return normalizeError(e) }
}
