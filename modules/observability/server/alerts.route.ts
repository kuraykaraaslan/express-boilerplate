import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertService from './alert.service'
import { ListAlertsQuery, ManualAlertDTO } from './alert.dto'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    // The list contract (`limit` / `offset` still work): whitelisted sort, status / severity / source lists, a range, a
    // title search. `items` stays beside `data`; `counts` per status feed the console's header and tabs.
    const query = readListQuery(request.nextUrl.searchParams, ListAlertsQuery)
    const page = await AlertService.listPage(tenantId, query)
    return NextResponse.json({ items: page.data, ...page })
  } catch (e) { return normalizeError(e) }
}

/** POST /api/alerts: raise an alert by hand (source `manual`). It goes through the same routing as any other. */

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    const dto = ManualAlertDTO.parse(await request.json())
    const result = await AlertService.ingest(tenantId, {
      source: 'manual', status: 'FIRING', title: dto.title, severity: dto.severity, labels: dto.labels ?? {}, annotations: dto.annotations ?? {},
    })
    return NextResponse.json({ item: result?.alert, status: result?.status, suppressedBy: result?.suppressedBy }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
