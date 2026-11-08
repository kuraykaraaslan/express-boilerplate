import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusPageService, { UpdateStatusPageDTO } from './status.page.service'

type Ctx = { params: Promise<{ tenantId: string; pageId: string }> }

/** One page for the admin screen. `default` addresses the default page. The password hash is never returned, only whether one is set. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, pageId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    return NextResponse.json({ item: await StatusPageService.getView(tenantId, pageId) })
  } catch (e) { return normalizeError(e) }
}

/** Change a page. Anything that makes it more visible (PUBLIC, on, embeddable, bound to a host) also takes `observability.status.publish`. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, pageId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const dto = UpdateStatusPageDTO.parse(await request.json())
    if (dto.audience === 'PUBLIC' || dto.enabled === true || dto.embedOrigins?.length || dto.domain) {
      await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.publish', scope: 'TENANT' })
    }
    return NextResponse.json({ item: await StatusPageService.update(tenantId, pageId, dto) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, pageId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    await StatusPageService.remove(tenantId, pageId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
