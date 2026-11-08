import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusPageService, { CreateStatusPageDTO } from './status.page.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/** Admin list of the tenant's status pages (the default page first; it has no row until it is first edited). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    return NextResponse.json({ items: await StatusPageService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/**
 * Create a page. Making a page PUBLIC, embeddable or bound to a host is an outward-facing act, so on top of `manage` it takes the narrow
 * `observability.status.publish` permission, the one that already guards publishing an incident.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const dto = CreateStatusPageDTO.parse(await request.json())
    if (dto.audience === 'PUBLIC' || dto.embedOrigins?.length || dto.domain) {
      await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.publish', scope: 'TENANT' })
    }
    return NextResponse.json({ item: await StatusPageService.create(tenantId, dto) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
