import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import SloService from './slo.service'
import { UpdateSloDTO } from './slo.dto'

/** GET /api/slos/{id}: the SLO, its report, and the daily series for the burn chart. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, sloId: string }> }) {
  try {
    const { tenantId, sloId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.read', scope: 'TENANT' })
    const [item, report, series] = await Promise.all([SloService.getById(tenantId, sloId), SloService.report(tenantId, sloId), SloService.dailySeries(tenantId, sloId)])
    return NextResponse.json({ item, report, series })
  } catch (e) { return normalizeError(e) }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string, sloId: string }> }) {
  try {
    const { tenantId, sloId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await SloService.update(tenantId, sloId, UpdateSloDTO.parse(await request.json())) })
  } catch (e) { return normalizeError(e) }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, sloId: string }> }) {
  try {
    const { tenantId, sloId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.manage', scope: 'TENANT' })
    await SloService.remove(tenantId, sloId)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(e) }
}
