import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeLocationService from './probe.location.service'
import { CreateLocationDTO } from './probe.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/probe-locations — the locations this workspace may pick: the live published ones and its own private ones. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.read', scope: 'TENANT' })
    return NextResponse.json({ items: await ProbeLocationService.list(tenantId) })
  } catch (e) { return normalizeError(e) }
}

/** POST /api/probe-locations — a private location (the ROOT tenant may publish a public one with `kind: PUBLIC`). */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await ProbeLocationService.create(tenantId, CreateLocationDTO.parse(await request.json()), user?.userId ?? null) }, { status: 201 })
  } catch (e) { return normalizeError(e) }
}
