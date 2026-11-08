import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { queryRaw } from './telemetry.query.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST /api/telemetry/query/raw: raw LogQL / PromQL / TraceQL. ROOT tenant only (the platform operator): any other workspace sees a 404, as
 * if the mode did not exist. The tenant header and tenant label of the root workspace still apply to what the adapter sends.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    if (!isRootTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.raw', scope: 'TENANT' })
    return NextResponse.json(await queryRaw(queryDeps, tenantId, await readJsonBody(request)))
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
