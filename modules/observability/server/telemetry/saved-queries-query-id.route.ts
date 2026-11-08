import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody } from './telemetry.http'
import { queryDeps } from './telemetry.routes.shared'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { deleteSavedQuery } from './telemetry.saved-queries'

type Ctx = { params: Promise<{ tenantId: string; queryId: string }> }

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, queryId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    if (!(await deleteSavedQuery(tenantId, user.userId, queryId))) throw new AppError('Saved query not found', 404, ErrorCode.NOT_FOUND)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
