import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusAutomationService, { UpsertAutomationDTO } from './status.automation.service'

type Ctx = { params: Promise<{ tenantId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    return NextResponse.json({ items: await StatusAutomationService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/**
 * Create or replace the auto-post template of a component (one per component). A template that publishes on its own (`autoPublish: true`)
 * is an outward-facing act, so it also takes `observability.status.publish`, exactly like publishing an incident by hand. Without it the
 * template can only ever draft PRIVATE incidents.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const dto = UpsertAutomationDTO.parse(await request.json())
    if (dto.autoPublish) {
      await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.publish', scope: 'TENANT' })
    }
    return NextResponse.json({ item: await StatusAutomationService.upsert(tenantId, dto) })
  } catch (e) { return normalizeError(e) }
}
