import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { bulkMonitors } from './uptime.monitor.ops'
import { BulkMonitorDTO } from './uptime.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** Pause, resume, delete or put up to 200 monitors into maintenance in one call. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    return NextResponse.json(await bulkMonitors(tenantId, BulkMonitorDTO.parse(await request.json())))
  } catch (e) { return normalizeError(e) }
}
