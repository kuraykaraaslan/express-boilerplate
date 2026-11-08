import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusPageService from './status.page.service'
import StatusComponentService from './status.component.service'
import { visibleComponents } from './status.page.rules'
import { SlaQueryDTO, periodFromQuery } from './sla.report.dto'
import { buildSlaReport, withReportSlot } from './sla.report.service'
import { reportResponse } from './sla.report.http'
import { auditSlaExport } from './sla.audit'

type Ctx = { params: Promise<{ tenantId: string; pageId: string }> }

/**
 * GET /api/status-pages/{pageId}/sla-report?from=YYYY-MM-DD&to=YYYY-MM-DD&format=json|csv|pdf&objective=99.9
 *
 * The uptime report of the components a status page shows, for a period of whole UTC days (at most 92; the default is the last 30 days): per component
 * the total, excluded-maintenance, unknown and downtime minutes, the uptime % the status page shows, incidents, outages and the longest outage.
 * Maintenance is excluded exactly as the status page and the SLOs exclude it (see `sla.report.ts`). `default` addresses the default page.
 * Permission: observability.status.read (the same as the page settings). Every export is audit-logged.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, pageId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    const query = SlaQueryDTO.parse(Object.fromEntries(request.nextUrl.searchParams))
    const now = new Date()
    const period = periodFromQuery(query, now, 30)
    const page = await StatusPageService.getView(tenantId, pageId)
    const components = visibleComponents(await StatusComponentService.list(tenantId), page)
    const report = await withReportSlot(tenantId, () => buildSlaReport({
      tenantId, now, period,
      scope: { kind: 'status_page', id: page.pageId ?? 'default', name: page.name },
      groups: components.map((c) => ({ key: c.componentId, name: c.name, monitorIds: c.monitorIds, componentId: c.componentId, objectivePercent: query.objective ?? null })),
    }))
    await auditSlaExport(tenantId, user?.userId ?? null, 'status_page', page.pageId ?? 'default', { from: report.period.from, to: report.period.to, format: query.format, rows: report.rows.length })
    return reportResponse(report, query.format)
  } catch (e) { return normalizeError(e) }
}
