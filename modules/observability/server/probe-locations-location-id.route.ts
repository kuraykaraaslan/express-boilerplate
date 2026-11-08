import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeLocationService from './probe.location.service'
import { UpdateLocationDTO } from './probe.dto'

type Ctx = { params: Promise<{ tenantId: string; locationId: string }> }

/**
 * Edit a location. Everything needs `observability.locations.manage`; touching what a PUBLIC status page may say about it (`publicVisible`,
 * `publicLabel`) also needs `observability.status.publish`, because customers see the result (the same split as publishing an incident). The body
 * is parsed BEFORE authorization (it has no side effects there) because it decides which permissions apply.
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, locationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const dto = UpdateLocationDTO.parse(await request.json())
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.manage', scope: 'TENANT' })
    if (dto.publicVisible !== undefined || dto.publicLabel !== undefined) {
      await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.publish', scope: 'TENANT' })
    }
    return NextResponse.json({ item: await ProbeLocationService.update(tenantId, locationId, dto, user?.userId ?? null) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, locationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.manage', scope: 'TENANT' })
    await ProbeLocationService.remove(tenantId, locationId, user?.userId ?? null)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
