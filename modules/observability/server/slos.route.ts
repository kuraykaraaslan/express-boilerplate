import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import SloService from './slo.service'
import { CreateSloDTO } from './slo.dto'

/** GET /api/slos: every SLO with its current budget, burn and tier state. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.read', scope: 'TENANT' })
    const rows = await SloService.reports(tenantId)
    return NextResponse.json({ items: rows.map(({ slo, report }) => ({ ...slo, report })) })
  } catch (e) { return normalizeError(e) }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.manage', scope: 'TENANT' })
    const item = await SloService.create(tenantId, CreateSloDTO.parse(await request.json()), user?.userId ?? null)
    return NextResponse.json({ item }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
