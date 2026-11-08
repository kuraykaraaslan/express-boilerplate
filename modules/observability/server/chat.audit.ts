/**
 * The audit trail of chat destinations (observability phase 14.7): who connected, changed, switched off, tested or removed a Slack or Teams
 * destination. Best-effort and optional (`audit_log` is an optional module): the change has already happened. The metadata names the kind,
 * the label, the host and which settings changed; the URL is never recorded, not even masked beyond its host.
 */
export type ChatAuditAction =
  | 'observability.chat.destination_created' | 'observability.chat.destination_updated' | 'observability.chat.destination_deleted'
  | 'observability.chat.destination_tested' | 'observability.chat.destination_suspended'

type Sink = (entry: { tenantId: string; actorId: string | null; action: ChatAuditAction; resourceId: string; metadata: Record<string, unknown> }) => Promise<void>

const defaultSink: Sink = async (entry) => {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
  await AuditLogService.log({
    tenantId: entry.tenantId, ...(entry.actorId ? { actorId: entry.actorId } : {}), actorType: entry.actorId ? 'USER' : 'SYSTEM',
    action: entry.action, resourceType: 'chat_destination', resourceId: entry.resourceId, metadata: entry.metadata,
  } as never)
}
let sink: Sink = defaultSink
/** Test seam. */
export function setChatAuditSink(fn?: Sink): void { sink = fn ?? defaultSink }

export async function auditChat(tenantId: string, actorId: string | null, action: ChatAuditAction, resourceId: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try { await sink({ tenantId, actorId, action, resourceId, metadata }) } catch { /* never undoes the change */ }
}
