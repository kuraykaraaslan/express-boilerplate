import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusComponentService from './status.component.service'
import StatusUptimeService from './status.uptime.service'
import { UpdateStatusComponentDTO } from './uptime.dto'

type Ctx = { params: Promise<{ tenantId: string; componentId: string }> }

/** One component with its uptime windows (24h from raw checks, 7/30/90d from
 *  the daily rollup). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, componentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    const item = await StatusComponentService.getById(tenantId, componentId)
    const uptime = await StatusUptimeService.componentUptime(tenantId, componentId)
    return NextResponse.json({ item, uptime })
  } catch (e) { return normalizeError(e) }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, componentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    const dto = UpdateStatusComponentDTO.parse(await request.json())
    return NextResponse.json({ item: await StatusComponentService.update(tenantId, componentId, dto) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, componentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    await StatusComponentService.remove(tenantId, componentId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
