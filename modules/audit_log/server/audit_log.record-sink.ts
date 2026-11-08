import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { auditLogRecordSinkLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/audit_log.record_sink';
import type { AuditSeverity } from './audit_log.enums';

/** Extension point id, declared in audit_log/module.json `extensionPoints` (docs/phases/55-ai-firewall/01 §1.4a). */
export const AUDIT_LOG_RECORD_SINK_POINT = 'audit_log:record_sink';

/**
 * One audit row as a sink hears it, after it was written. Read-only: every sink sees the same object.
 *
 * The actor ids travel in the clear although a SEALED chain keeps only pseudonymous references in its rows: the sinks are in-tree code of
 * this install (the firewall must act on the person, FWA-5), and each sink that stores what it hears covers that store with its own
 * export and erasure contributions. Nothing here is a secret (the write path refuses none, and scrubs none: callers never put one in).
 */
export interface WrittenAuditRecord {
  tenantId: string;
  action: string;
  severity: AuditSeverity;
  actorType: string;
  actorId: string | null;
  onBehalfOfActorId: string | null;
  actorTenantId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
  nodeId: string | null;
  occurredAt: Date;
  /** The tenant's chain mode when the row was written. */
  sealed: boolean;
}

/**
 * A module that wants to hear every written audit row.
 *
 * `actions` narrows the subscription; a sink without it hears every row, which is worth having to say out loud.
 */
export interface AuditRecordSink {
  key?: string;
  actions?: string[];
  onRecord(record: WrittenAuditRecord): Promise<void> | void;
}

/**
 * Tell the sinks about a row that was written, and never let them affect the write.
 *
 * `log()` sits on the path of every audited operation, so this is fire-and-forget by construction: it is called only after the row's
 * transaction committed, it is a detached fan-out (nobody waits for it), only sinks of modules active for the tenant hear the row, every
 * sink is isolated, and a throw, a sink that never settles, or a stale snapshot is logged and dropped. It returns nothing and never throws.
 */
export function notifyRecordSinks(record: WrittenAuditRecord): void {
  try {
    const frozen = Object.freeze({ ...record, metadata: record.metadata ? Object.freeze({ ...record.metadata }) : null });
    void ext.fanOut<AuditRecordSink>(
      AUDIT_LOG_RECORD_SINK_POINT, tenantCtx(record.tenantId), auditLogRecordSinkLoaders,
      async (sink) => {
        if (sink.actions?.length && !sink.actions.includes(frozen.action)) return;
        await sink.onRecord(frozen);
      },
      { detached: true },
    ).catch(() => undefined);
  } catch {
    // a sink never changes the write
  }
}
