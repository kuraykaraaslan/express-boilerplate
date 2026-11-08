import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { changeWindow, changesBetween, DEFAULT_LOOKBACK_MINUTES } from './incident.changes.service'
import { Incident } from './entities/incident.entity'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'

/** GET /api/incidents/{id}/changes?lookback=60: what changed in the hours before the incident started, and during it. */

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string, incidentId: string }> }) {
  try {
    const { tenantId, incidentId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.incidents.read', scope: 'TENANT' })
    const incident = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }))
    if (!incident) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
    const { from, to } = changeWindow(incident, new Date(), Number(request.nextUrl.searchParams.get('lookback')) || DEFAULT_LOOKBACK_MINUTES)
    return NextResponse.json({ from, to, items: await changesBetween(tenantId, from, to) })
  } catch (e) { return normalizeError(e) }
}
