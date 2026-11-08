import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertSilenceService from './alert.silence.service'

/** DELETE ends the silence now (the record stays). */

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string, silenceId: string }> }) {
  try {
    const { tenantId, silenceId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.manage', scope: 'TENANT' })
    return NextResponse.json({ item: await AlertSilenceService.expire(tenantId, silenceId) })
  } catch (e) { return normalizeError(e) }
}
