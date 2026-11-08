import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { listSupervisors } from './process.scaling.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET /api/processes/scaling — every live process supervisor (07 task 6): state, children, recent decisions, last-hour
 * signal. ROOT tenant only, same permission as the processes page (`observability.processes.read`). Read-only.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    if (!isRootTenant(tenantId)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.processes.read', scope: 'TENANT' })
    return NextResponse.json(await listSupervisors())
  } catch (e) { return normalizeError(e) }
}
