import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { cloneMonitor } from './uptime.monitor.ops'
import { serializeMonitor } from './uptime.monitor.serialize'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string }> }

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    const { monitor, heartbeatToken } = await cloneMonitor(tenantId, monitorId)
    return NextResponse.json({ item: serializeMonitor(monitor), ...(heartbeatToken ? { heartbeatToken } : {}) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
