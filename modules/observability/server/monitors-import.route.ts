import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { importMonitors } from './uptime.monitor.ops'
import { ImportMonitorsDTO } from './uptime.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** CSV / YAML / JSON import. `dryRun` defaults to true: the response is the validation report, nothing is written. */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.monitors.manage', scope: 'TENANT' })
    return NextResponse.json(await importMonitors(tenantId, ImportMonitorsDTO.parse(await request.json())))
  } catch (e) { return normalizeError(e) }
}
