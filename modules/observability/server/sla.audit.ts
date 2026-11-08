/**
 * The audit trail of SLA report exports (observability phase 13.5): who exported which report, for which period, in which format, with how many rows.
 * A report names components and monitors and carries uptime figures a customer may hold the operator to, so a download is an event worth keeping.
 * Best-effort and optional (`audit_log` is an optional module): the export has already been produced, a failure to record it does not undo it.
 * Only identifiers, the period, the format and counts are recorded, never the report's content.
 */
export type SlaAuditAction = 'observability.sla_report.exported'

export interface SlaAuditEntry {
  tenantId: string
  actorId: string | null
  action: SlaAuditAction
  resourceType: 'status_page' | 'slo'
  resourceId: string
  metadata: Record<string, unknown>
}

type Sink = (entry: SlaAuditEntry) => Promise<void>

const defaultSink: Sink = async (entry) => {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
  await AuditLogService.log({
    tenantId: entry.tenantId, ...(entry.actorId ? { actorId: entry.actorId } : {}), actorType: entry.actorId ? 'USER' : 'SYSTEM',
    action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId, metadata: entry.metadata,
  } as never)
}
let sink: Sink = defaultSink
/** Test seam. */
export function setSlaAuditSink(fn?: Sink): void { sink = fn ?? defaultSink }

export async function auditSlaExport(
  tenantId: string, actorId: string | null, resourceType: 'status_page' | 'slo', resourceId: string,
  detail: { from: string; to: string; format: string; rows: number },
): Promise<void> {
  try { await sink({ tenantId, actorId, action: 'observability.sla_report.exported', resourceType, resourceId, metadata: { ...detail } }) } catch { /* never undoes the export */ }
}
