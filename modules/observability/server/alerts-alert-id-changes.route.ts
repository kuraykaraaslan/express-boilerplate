import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import AlertService from './alert.service'
import { changeWindow, changesBetween, DEFAULT_LOOKBACK_MINUTES } from './incident.changes.service'

/**
 * GET /api/alerts/{id}/changes?lookback=60: what changed in the hour before the alert started, and while it fired. The twin of
 * `/api/incidents/{id}/changes` for the alert screens (phase 18.5): the same sources, the same window rule, behind the alert read permission.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, alertId: string }> }) {
  try {
    const { tenantId, alertId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.alerts.read', scope: 'TENANT' })
    const alert = await AlertService.getById(tenantId, alertId)
    const { from, to } = changeWindow({ startedAt: alert.startsAt, resolvedAt: alert.endsAt }, new Date(), Number(request.nextUrl.searchParams.get('lookback')) || DEFAULT_LOOKBACK_MINUTES)
    return NextResponse.json({ from, to, items: await changesBetween(tenantId, from, to) })
  } catch (e) { return normalizeError(e) }
}
