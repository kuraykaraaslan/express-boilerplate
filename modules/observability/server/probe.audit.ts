/**
 * The audit trail of probe locations (observability phase 10.6): who created a location, changed what it may reach, minted an enrolment token, and which
 * runner enrolled or was revoked. Best-effort and optional (`audit_log` is an optional module): the change has already happened, so a failure to record it
 * never undoes it. Allow-lists are recorded as lists (they are not secrets); tokens and keys never are.
 */
export type ProbeAuditAction =
  | 'observability.probe.location_created' | 'observability.probe.location_updated' | 'observability.probe.location_deleted'
  | 'observability.probe.location_exposure_changed'
  | 'observability.probe.enrolment_created' | 'observability.probe.runner_enrolled' | 'observability.probe.runner_revoked'

type Sink = (entry: { tenantId: string; actorId: string | null; action: ProbeAuditAction; resourceType: string; resourceId: string; metadata: Record<string, unknown> }) => Promise<void>

const defaultSink: Sink = async (entry) => {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
  await AuditLogService.log({
    tenantId: entry.tenantId, ...(entry.actorId ? { actorId: entry.actorId } : {}), actorType: entry.actorId ? 'USER' : 'SYSTEM',
    action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId, metadata: entry.metadata,
  } as never)
}
let sink: Sink = defaultSink
/** Test seam. */
export function setProbeAuditSink(fn?: Sink): void { sink = fn ?? defaultSink }

export async function auditProbe(tenantId: string, actorId: string | null, action: ProbeAuditAction, resourceType: 'probe_location' | 'probe_runner', resourceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try { await sink({ tenantId, actorId, action, resourceType, resourceId, metadata }) } catch { /* never undoes the change */ }
}
