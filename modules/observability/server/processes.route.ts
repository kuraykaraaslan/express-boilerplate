import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { listProcesses } from './process.registry.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/processes — every live sidecar node, grouped on the client. ROOT tenant only. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    if (!isRootTenant(tenantId)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.processes.read', scope: 'TENANT' })
    return NextResponse.json(await listProcesses())
  } catch (e) { return normalizeError(e) }
}
