import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import SloService from './slo.service'
import { resolveMonitorIds } from './slo.sli'
import { SlaQueryDTO, periodFromQuery } from './sla.report.dto'
import { buildSlaReport, withReportSlot } from './sla.report.service'
import { reportResponse } from './sla.report.http'
import { auditSlaExport } from './sla.audit'

type Ctx = { params: Promise<{ tenantId: string; sloId: string }> }

/**
 * GET /api/slos/{sloId}/sla-report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv|pdf
 *
 * The uptime report of the monitors an availability SLO measures (its component's monitors when it names one), with the SLO's objective as the target
 * (`objectiveMet` is the published uptime % against it). The default period is the SLO's window up to today, at most 92 days. A latency or a metric SLO
 * has no availability to report and is a 400. Permission: observability.slos.read (the same as the SLO detail). Every export is audit-logged.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, sloId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.slos.read', scope: 'TENANT' })
    const query = SlaQueryDTO.parse(Object.fromEntries(request.nextUrl.searchParams))
    const slo = await SloService.getById(tenantId, sloId)
    if (slo.kind !== 'MONITOR_AVAILABILITY') throw new AppError('An SLA report needs an availability SLO: this one measures latency or a metric', 400, ErrorCode.VALIDATION_ERROR)
    const now = new Date()
    const period = periodFromQuery(query, now, Math.min(slo.windowDays, 92))
    const monitorIds = await resolveMonitorIds(tenantId, slo)
    const report = await withReportSlot(tenantId, () => buildSlaReport({
      tenantId, now, period, scope: { kind: 'slo', id: slo.sloId, name: slo.name },
      groups: [{ key: slo.sloId, name: slo.name, monitorIds, componentId: slo.componentId ?? null, objectivePercent: Number(slo.objectivePercent) }],
    }))
    await auditSlaExport(tenantId, user?.userId ?? null, 'slo', slo.sloId, { from: report.period.from, to: report.period.to, format: query.format, rows: report.rows.length })
    return reportResponse(report, query.format)
  } catch (e) { return normalizeError(e) }
}
