import { IsNull, LessThanOrEqual, Not } from 'typeorm';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { isReservedTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { Tenant } from './entities/tenant.entity';
import { askPurgeRetention, retentionMatcher } from './tenant.purge-retention';

/**
 * The purge's file step, retention-aware (docs/phases/37-extensions/11, "2026-10-17: retention-aware purge").
 *
 * The purge used to delete every object listed in `uploaded_files` for the tenant, issued invoice PDFs and documents
 * under an unexpired retention included, while the rows that point at them survived. Now every file of a purged tenant
 * gets a verdict from the `tenant:purge_retention` contributors: kept until its retention ends (the date and reason go
 * on its `uploaded_files` row), or deleted as before. A kept file is asked about again once its date has passed, by the
 * same code from the daily sweep, so a hold that still stands keeps it for longer and a lapsed one lets it go.
 *
 * Fail closed: when a contributor cannot answer, no file of the tenant is deleted on that run. Only this step waits;
 * the rest of the purge (keys, caches, the row) goes ahead, because what is deferred is exactly the irreversible part
 * and nothing else depends on it. The files stay due and the next sweep asks again.
 *
 * Batched: files are read 500 at a time in key order and at most {@link MAX_FILES_PER_RUN} are judged per tenant per
 * run; what is left stays due and the next run continues. Every step is idempotent, so an interrupted run is resumed.
 */

const BATCH = 500;
/** Per tenant and run, so one tenant with millions of files cannot hold the daily job for a day; the next run continues. */
const MAX_FILES_PER_RUN = 50_000;
/** Tenants whose retained files are due, per sweep run. */
const TENANTS_PER_SWEEP = 50;
/** The reason a file carries between the purge opening it and its verdict (also while a deferred step waits). */
const AWAITING_VERDICT = 'tenant purge: awaiting the retention check';

export interface PurgeFilesOutcome {
  deleted: number;
  retained: number;
  /** Deletes the storage provider refused; those files stay due and are tried again on the next run. */
  failed: number;
  /** Why no file was judged (a contributor could not answer); null when the step ran. */
  deferred: string | null;
  /** When this tenant's next file needs a verdict; null when none is left. */
  nextDueAt: Date | null;
}

export interface RetainedFilesSweepResult {
  tenants: number;
  deleted: number;
  retained: number;
  failed: number;
  deferred: number;
}

const loadStore = () => import('@kuraykaraaslan-labs/storage/server/storage.purge-retention');

/** The tenant row's marker, written on the shared registry like the purge's due list (system scope: the row is soft-deleted). */
async function markDue(tenantId: string, due: Date | null): Promise<void> {
  await withSystemRLS((qr) => qr.manager.getRepository(Tenant).update({ tenantId }, { retainedFilesDueAt: due }));
}

/**
 * The purge's step 3: open every live file of the tenant for a verdict, then judge them. The marker is written first,
 * so a run that dies halfway is picked up by the sweep instead of leaving files nobody looks at again.
 */
export async function purgeTenantFiles(tenantId: string, now: Date): Promise<PurgeFilesOutcome> {
  await markDue(tenantId, now);
  const store = await loadStore();
  await store.openFilesForPurge(tenantId, now, AWAITING_VERDICT);
  return settleTenantFiles(tenantId, now);
}

/**
 * Judges the tenant's files that are due (opened by the purge, or whose retention has ended): kept again when a
 * contributor still retains them, deleted otherwise. Ends by writing the tenant's next due date.
 */
export async function settleTenantFiles(tenantId: string, now: Date): Promise<PurgeFilesOutcome> {
  const store = await loadStore();
  const answer = await askPurgeRetention(tenantId);
  if (!answer.ok) {
    Logger.warn(`[TenantDeletion] Files of tenant ${tenantId} kept for now, a retention check could not answer: ${answer.reason}`);
    const nextDueAt = await store.nextPurgeFileDue(tenantId);
    await markDue(tenantId, nextDueAt);
    return { deleted: 0, retained: 0, failed: 0, deferred: answer.reason, nextDueAt };
  }

  const retainedBy = retentionMatcher(answer.holds, now);
  let deleted = 0;
  let retained = 0;
  let failed = 0;
  let after: string | null = null;
  for (let seen = 0; seen < MAX_FILES_PER_RUN;) {
    const rows = await store.purgeFilesDue(tenantId, now, after, Math.min(BATCH, MAX_FILES_PER_RUN - seen));
    if (rows.length === 0) break;
    seen += rows.length;
    after = rows[rows.length - 1]!.uploadedFileId;

    const keep: Array<{ uploadedFileId: string; retainUntil: Date; reason: string }> = [];
    const drop: string[] = [];
    for (const row of rows) {
      const hold = retainedBy(row.key);
      if (hold) keep.push({ uploadedFileId: row.uploadedFileId, ...hold });
      else drop.push(row.key);
    }
    await store.retainPurgeFiles(tenantId, keep);
    retained += keep.length;
    if (drop.length > 0) {
      const { default: StorageService } = await import('@kuraykaraaslan-labs/storage/server/storage.service');
      for (const key of drop) {
        // A refused delete leaves the row due, so the next run tries it again.
        await StorageService.deleteFile(tenantId, { key }).then(() => { deleted++; }, () => { failed++; });
      }
    }
    if (rows.length < BATCH) break;
  }
  if (failed > 0) Logger.warn(`[TenantDeletion] ${failed} file(s) of tenant ${tenantId} could not be deleted; the next run tries again`);

  const nextDueAt = await store.nextPurgeFileDue(tenantId);
  await markDue(tenantId, nextDueAt);
  return { deleted, retained, failed, deferred: null, nextDueAt };
}

/**
 * The daily sweep over purged tenants whose retained files are due (run by the purge job and its cron route, after the
 * purge itself). Never throws: a tenant that fails is logged and keeps its marker, so it is tried again tomorrow.
 */
export async function sweepRetainedFiles(now = new Date()): Promise<RetainedFilesSweepResult> {
  const out: RetainedFilesSweepResult = { tenants: 0, deleted: 0, retained: 0, failed: 0, deferred: 0 };
  let due: Array<Pick<Tenant, 'tenantId'>>;
  try {
    due = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).find({
      select: { tenantId: true },
      where: { retainedFilesDueAt: LessThanOrEqual(now), deletedAt: Not(IsNull()) },
      withDeleted: true,
      order: { retainedFilesDueAt: 'ASC' },
      take: TENANTS_PER_SWEEP,
    }));
  } catch (err) {
    Logger.error(`[TenantDeletion] Retained-file sweep could not list its tenants: ${err instanceof Error ? err.message : String(err)}`);
    return out;
  }
  for (const { tenantId } of due) {
    // Never purged, so never marked; checked anyway, as everywhere else on the purge path.
    if (isReservedTenant(tenantId)) continue;
    try {
      const r = await settleTenantFiles(tenantId, now);
      out.tenants++;
      out.deleted += r.deleted;
      out.retained += r.retained;
      out.failed += r.failed;
      if (r.deferred) out.deferred++;
    } catch (err) {
      Logger.error(`[TenantDeletion] Retained files of tenant ${tenantId} not settled: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}
