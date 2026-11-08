import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import MonitorService from './uptime.monitor.service'
import { CreateMonitorDTO, ListMonitorsQuery } from './uptime.dto'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'

const LIST_KEYS = new Set(['page', 'pageSize', 'limit', 'sort', 'search', 'q', 'type', 'isActive', 'groupName'])
import { serializeMonitor } from './uptime.monitor.serialize'

type Ctx = { params: Promise<{ tenantId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    const sp = new URL(request.url).searchParams
    // Pickers (alert dependencies, status components) read the whole list with no query: that stays as it was. Any list
    // parameter is the list contract (a page, whitelisted sort, type / active / group filters, a search).
    if (![...sp.keys()].some((k) => LIST_KEYS.has(k))) {
      return NextResponse.json({ items: (await MonitorService.list(tenantId)).map(serializeMonitor) })
    }
    const page = await MonitorService.listPage(tenantId, readListQuery(sp, ListMonitorsQuery))
    const data = page.data.map(serializeMonitor)
    return NextResponse.json({ items: data, data, total: page.total })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    const dto = CreateMonitorDTO.parse(await request.json())
    const { heartbeatToken, ...created } = await MonitorService.create(tenantId, { ...dto, target: dto.target ?? (dto.type === 'HEARTBEAT' ? 'heartbeat' : 'steps') })
    // The plaintext heartbeat token is shown exactly once, here.
    return NextResponse.json({ item: serializeMonitor(created as never), ...(heartbeatToken ? { heartbeatToken } : {}) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
