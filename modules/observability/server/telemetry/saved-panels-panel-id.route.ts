import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError } from './telemetry.http'
import { deleteSavedPanel } from './telemetry.saved-panels'

type Ctx = { params: Promise<{ tenantId: string; panelId: string }> }

/** DELETE /api/telemetry/saved-panels/[panelId] */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, panelId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.manage', scope: 'TENANT' })
    if (!(await deleteSavedPanel(tenantId, user.userId, panelId))) throw new AppError('Saved panel not found', 404, ErrorCode.NOT_FOUND)
    return NextResponse.json({ ok: true })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
