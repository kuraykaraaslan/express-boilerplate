import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import { runWithTenant } from '@kuraykaraaslan-labs/db/server/db.context';
import Logger from '@kuraykaraaslan-labs/logger';
import ObservabilityService from '@kuraykaraaslan-labs/observability/server/observability.service';
import AuditLogService from './audit_log.service';
import { resolveChainMode } from './audit_log.mode';
import { resolveArchiveExporter } from './audit_log.archive.port';
import { AuditActions } from './audit_log.enums';
import type { AuditArchiveExporter } from './audit_log.types';

/**
 * The retention purge sweep, free of any queue so the BullMQ job (`audit_log.purge.job`) and the cron route (`POST /api/cron/audit-log-purge`) run the same
 * body. For every active tenant it runs `AuditLogService.purgeExpired`, which is a no-op for a tenant that keeps everything.
 *
 *  - SEALED tenants are archived BY DEFAULT when an archive destination exists (extension point `audit_log:archive_exporter`): the rows are written before
 *    they are deleted, and a destination that is configured but cannot be reached skips that tenant instead of deleting rows the operator meant to keep.
 *    Without a destination the purge proceeds, the chain stays provable through its checkpoint. A LEGACY tenant is never archived (its rows carry the actor id
 *    in the clear; an archive of them would defeat erasure).
 *  - Every tenant that lost rows gets ONE audit row, `audit.purged`, in its own chain (how many, up to when, whether archived): a purge is itself an event
 *    the trail records.
 *  - Counters, never per tenant (`audit_log_purged_rows_total{mode,archived}`), so a purge is visible in the scrape without a cardinality problem.
 *  - One tenant failing is logged and counted and never stops the others.
 */
export interface AuditPurgeSweepResult {
  tenants: number;
  /** Rows deleted across every tenant. */
  purged: number;
  /** Tenants whose rows were written to the archive before they were deleted. */
  archived: number;
  /** Tenants that failed (or were skipped because the archive destination could not be resolved). */
  errors: number;
}

let purgedCounter: ReturnType<typeof ObservabilityService.counter> | null = null;
const counter = () => (purgedCounter ??= ObservabilityService.counter({
  name: 'audit_log_purged_rows_total', help: 'Audit rows deleted by the retention purge', labelNames: ['mode', 'archived'],
}));

export async function runAuditPurgeSweep(): Promise<AuditPurgeSweepResult> {
  const tenants = await listActiveTenants();
  const result: AuditPurgeSweepResult = { tenants: tenants.length, purged: 0, archived: 0, errors: 0 };

  // Resolved once per sweep. A destination that cannot be resolved is remembered, not thrown: legacy tenants are unaffected, sealed ones are skipped.
  let exporter: AuditArchiveExporter | null = null;
  let exporterFailed = false;
  try { exporter = await resolveArchiveExporter(); } catch (err) {
    exporterFailed = true;
    Logger.error(`[CronJob:audit-log-purge] the archive destination could not be resolved, sealed tenants are skipped: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const tenant of tenants) {
    const { tenantId } = tenant;
    try {
      const sealed = (await resolveChainMode(tenantId)) === 'sealed';
      if (sealed && exporterFailed) { result.errors += 1; continue; }
      const archive = sealed && exporter !== null;
      const purge = await runWithTenant(tenantId, () => AuditLogService.purgeExpired({ tenantId, archive }, archive ? exporter! : undefined));
      if (purge.purged === 0) continue;

      result.purged += purge.purged;
      if (archive) result.archived += 1;
      counter().inc({ mode: sealed ? 'sealed' : 'legacy', archived: archive ? 'true' : 'false' }, purge.purged);
      // The record of the purge is best effort: the rows are already gone, and failing to say so must not fail the sweep or hide the next tenant.
      try {
        await runWithTenant(tenantId, () => AuditLogService.log({
          tenantId, actorType: 'SYSTEM', action: AuditActions.CHAIN_PURGED, resourceType: 'audit_chain', resourceId: tenantId,
          metadata: { purged: purge.purged, archived: archive, through: purge.cutoff ? purge.cutoff.toISOString() : null },
        }));
      } catch (err) {
        Logger.error(`[CronJob:audit-log-purge] tenant=${tenantId} could not record the purge: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      result.errors += 1;
      Logger.error(`[CronJob:audit-log-purge] tenant=${tenantId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
