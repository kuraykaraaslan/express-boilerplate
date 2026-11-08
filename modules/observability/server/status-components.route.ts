import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusComponentService from './status.component.service'
import { CreateStatusComponentDTO } from './uptime.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** Admin CRUD for status components. The PUBLIC status page (phase 3) gets its
 *  own allowlist-serialized route — this one may include monitorIds, so it
 *  stays behind the observability permissions. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.read', scope: 'TENANT' })
    return NextResponse.json({ items: await StatusComponentService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    const dto = CreateStatusComponentDTO.parse(await request.json())
    return NextResponse.json({ item: await StatusComponentService.create(tenantId, dto) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
