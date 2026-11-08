import { createHash } from 'node:crypto';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { tenantKeys, type TenantKeyDestroyReport, type TenantKeyDestroyReason } from '@kuraykaraaslan-labs/db/server/db.tenant-keys.service';
import { resealTenantKeyColumns } from '@kuraykaraaslan-labs/db/server/db.tenant-key-backfill.job';
import { loadTenantKeyColumns } from '@kuraykaraaslan-labs/db/server/db.tenant-key-columns';

/**
 * Crypto-shredding on tenant purge (P7-TDEK; docs/phases/02-fleet/04 section 3 level L3, 06 section 6). The last step of the purge cascade, after
 * every step that may still need the tenant's secrets (a purge step cancelling the subscription with the payment provider reads its key):
 *  1. the tenant's declared columns (`db:tenant_key_columns`) are resealed to the end (`resealTenantKeyColumns`): every value the online backfill had
 *     not reached yet (legacy plaintext, a v1 or node-key envelope) goes under the tenant's key, on the system database and the tenant's own one,
 *     so the destroy below reaches it too instead of leaving it readable in the live database. When this cannot finish, no key is destroyed (the
 *     outcome is TDEK_FAILED and the sweep retries the whole step);
 *  2. every data key of the tenant is destroyed (`tenantKeys.destroy(tenantId, reason)`), so whatever is left of its declared columns in the live
 *     database, in replicas and, with a provider that keeps its slots outside the database, in backups, is unreadable for good; after TENANT_PURGE
 *     no key is ever created for the tenant again.
 *
 * What it reports, counts and hashes only (class G, for the PURGED lifecycle receipt and the tenant's audit chain):
 *  - TDEK_DESTROYED, TDEK_ESCROWED (still restorable from a legal-hold escrow until it ends), TDEK_PENDING_SLOTS (provider slots that could not be
 *    destroyed: stamped on the key rows, the sweep reruns the destroy), TDEK_UNSHREDDED (keys wrapped by another provider), TDEK_RESEALED (values
 *    sealed at purge time: a backup taken before the purge holds them in their old shape), TDEK_UNCONVERTED (values that did not open and stay as
 *    they are, readable by no key), TDEK_SHREDS_BACKUPS (1 only when the destruction reaches backups taken before it: a provider that shreds
 *    backups, every slot destroyed, no key of another provider, and nothing resealed at purge time), TDEK_FAILED (1 when the reseal or the destroy
 *    failed: the keys stand, the sweep retries);
 *  - TDEK_FAMILIES: how many key-protected families are declared, and the hash TDEK_FAMILIES of their sorted names, so the receipt names what was
 *    shredded without carrying free text.
 * Never throws: a failure is logged, audited and reported, and `sweepPurgedTenantKeys` retries the tenants whose keys still stand. Known limit: a
 * reseal that fails before the tenant's first key exists leaves no key row for the sweep to find; its leftovers stay visible in the node's
 * `encryption.tdek_enabled` check (only the rows of tenants whose keys a purge destroyed are left out there).
 */
export interface TenantKeyShredOutcome {
  counts: Record<string, number>;
  hashes: Record<string, string>;
  report: TenantKeyDestroyReport | null;
  error?: string;
}

/** The declared families (sorted, unique) and their hash; empty when no module declares a column or the declarations cannot be loaded. */
export async function keyProtectedFamilies(): Promise<{ families: string[]; hash: string }> {
  const families = await loadTenantKeyColumns()
    .then((sets) => [...new Set(sets.map((s) => s.family.trim()))].sort())
    .catch(() => [] as string[]);
  return { families, hash: createHash('sha256').update(`nb.tdek.families.v1\n${families.join('\n')}`).digest('hex') };
}

function audit(tenantId: string, action: string, metadata: Record<string, unknown>): void {
  AuditLogService.log({
    tenantId, actorId: null, actorType: 'SYSTEM', action, resourceType: 'Tenant', resourceId: tenantId, metadata,
  }).catch(() => { /* an audit outage never undoes a destroyed key */ });
}

export async function shredTenantKeys(tenantId: string, reason: Extract<TenantKeyDestroyReason, 'TENANT_PURGE' | 'MIGRATED_AWAY'> = 'TENANT_PURGE'): Promise<TenantKeyShredOutcome> {
  const { families, hash } = await keyProtectedFamilies();
  const base = { TDEK_FAMILIES: families.length };
  const hashes = { TDEK_FAMILIES: hash };
  try {
    const r = await resealTenantKeyColumns(tenantId);
    const report = await tenantKeys.destroy(tenantId, reason);
    const counts = {
      ...base,
      TDEK_DESTROYED: report.destroyed.length,
      TDEK_ESCROWED: report.escrowed.length,
      TDEK_PENDING_SLOTS: report.pendingSlots.length,
      TDEK_UNSHREDDED: report.unshredded.length,
      TDEK_RESEALED: r.sealed,
      TDEK_UNCONVERTED: r.unreadable,
      TDEK_SHREDS_BACKUPS: report.shredsBackups && r.sealed === 0 ? 1 : 0,
      TDEK_FAILED: 0,
    };
    audit(tenantId, 'tenant.keys_destroyed', { provider: report.provider, reason, ...counts });
    if (report.pendingSlots.length || report.unshredded.length) {
      Logger.warn(`[TenantDeletion] tenant ${tenantId}: data keys destroyed, but ${report.pendingSlots.length} provider slot(s) pending (the sweep retries) and ${report.unshredded.length} key(s) of another provider: pre-purge backups still open them`);
    }
    if (r.sealed) Logger.warn(`[TenantDeletion] tenant ${tenantId}: ${r.sealed} value(s) were sealed under the tenant key only at purge time: pre-purge backups hold them in their old shape`);
    return { counts, hashes, report };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    Logger.error(`[TenantDeletion] tenant ${tenantId}: data keys NOT destroyed (the sweep retries): ${error}`);
    audit(tenantId, 'tenant.keys_destroy_failed', { reason, ...base });
    return { counts: { ...base, TDEK_DESTROYED: 0, TDEK_FAILED: 1 }, hashes, report: null, error };
  }
}
