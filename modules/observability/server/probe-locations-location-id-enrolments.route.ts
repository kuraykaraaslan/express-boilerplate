import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeRunnerService from './probe.runner.service'

type Ctx = { params: Promise<{ tenantId: string; locationId: string }> }

/** The token is in this response and nowhere else, ever: single use, valid for an hour, only its hash is stored. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, locationId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.manage', scope: 'TENANT' })
    const { token, expiresAt, locationKey } = await ProbeRunnerService.createEnrolment(tenantId, locationId, user?.userId ?? null)
    return NextResponse.json({ token, expiresAt, locationKey }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return normalizeError(e) }
}
