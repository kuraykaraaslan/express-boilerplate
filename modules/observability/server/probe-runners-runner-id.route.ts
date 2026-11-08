import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import ProbeRunnerService from './probe.runner.service'

type Ctx = { params: Promise<{ tenantId: string; runnerId: string }> }

/** DELETE /api/probe-runners/[runnerId] — revoke: the runner's next request is a 401. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, runnerId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.locations.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await ProbeRunnerService.revoke(tenantId, runnerId, new Date(), user?.userId ?? null) })
  } catch (e) { return normalizeError(e) }
}
