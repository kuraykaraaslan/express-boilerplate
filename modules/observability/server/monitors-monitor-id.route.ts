import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import MonitorService from './uptime.monitor.service'
import { UpdateMonitorDTO, monitorProblem } from './uptime.dto'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { serializeMonitor } from './uptime.monitor.serialize'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    return NextResponse.json({ item: serializeMonitor(await MonitorService.getById(tenantId, monitorId)) })
  } catch (e) { return normalizeError(e) }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    const dto = UpdateMonitorDTO.parse(await request.json())
    // A partial update is checked against the stored row: changing the target of an HTTP monitor must still leave a URL.
    if (dto.type !== undefined || dto.target !== undefined || dto.steps !== undefined || dto.browser !== undefined || dto.locations !== undefined) {
      const current = await MonitorService.getById(tenantId, monitorId)
      const problem = monitorProblem({
        type: dto.type ?? current.type, target: dto.target ?? current.target, steps: dto.steps ?? current.steps, browser: dto.browser ?? current.browser,
        locations: dto.locations !== undefined ? dto.locations : (current as { locations?: string[] | null }).locations,
      })
      if (problem) throw new AppError(problem, 400, ErrorCode.VALIDATION_ERROR)
    }
    return NextResponse.json({ item: serializeMonitor(await MonitorService.update(tenantId, monitorId, dto)) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    await MonitorService.remove(tenantId, monitorId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
