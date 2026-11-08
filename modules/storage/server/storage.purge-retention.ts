import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db'

/**
 * The `uploaded_files` rows of a PURGED tenant, for the purge's file step (tenant/server/tenant.purge-files.ts,
 * docs/phases/37-extensions/11 "2026-10-17: retention-aware purge").
 *
 * A file of a purged tenant is always in one of three states, carried on its row:
 *  - live and `retainUntil` in the future: a module must keep it until then (`retentionReason` says which and why);
 *  - live and `retainUntil` passed (or stamped "now" when the purge opened it): due for a verdict — kept again, or deleted;
 *  - soft-deleted: the object is gone (`StorageService.deleteFile`), the row stays for audit as for any deleted file.
 * While the tenant lives both columns are null and nothing here is called.
 *
 * Raw SQL in the tenant's own scope (RLS applies), batched by primary key, so a tenant with millions of files is
 * never loaded at once.
 */

export interface PurgeFileRow {
  uploadedFileId: string
  key: string
}

export interface RetainedPurgeFile {
  uploadedFileId: string
  retainUntil: Date
  reason: string
}

/** The column is varchar(255); a contributor's reason is cut to fit rather than failing the batch. */
const REASON_MAX = 255

/**
 * Every live file of the tenant without a verdict becomes due for one at `now`. Idempotent: a file that already
 * carries a date (an earlier, interrupted run) keeps it. Returns how many rows were opened.
 */
export async function openFilesForPurge(tenantId: string, now: Date, reason: string): Promise<number> {
  const res = await withTenantTransactionFor(tenantId, (qr) => qr.query(
    `UPDATE uploaded_files SET "retainUntil" = $2, "retentionReason" = $3
      WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "retainUntil" IS NULL`,
    [tenantId, now, reason.slice(0, REASON_MAX)],
  ))
  // node-postgres answers an UPDATE through TypeORM's query() as [rows, affected].
  return Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0
}

/** One batch of live files whose retention has ended (or that were opened), after `after` in primary-key order. */
export async function purgeFilesDue(tenantId: string, now: Date, after: string | null, limit: number): Promise<PurgeFileRow[]> {
  return withTenantTransactionFor(tenantId, (qr) => qr.query(
    `SELECT "uploadedFileId", key FROM uploaded_files
      WHERE "tenantId" = $1 AND "deletedAt" IS NULL AND "retainUntil" <= $2
        AND ($3::uuid IS NULL OR "uploadedFileId" > $3::uuid)
      ORDER BY "uploadedFileId" LIMIT $4`,
    [tenantId, now, after, limit],
  ))
}

/** Keep these files until their new date, one statement per batch. */
export async function retainPurgeFiles(tenantId: string, rows: RetainedPurgeFile[]): Promise<void> {
  if (rows.length === 0) return
  await withTenantTransactionFor(tenantId, (qr) => qr.query(
    `UPDATE uploaded_files AS f SET "retainUntil" = v.until, "retentionReason" = v.reason
       FROM unnest($2::uuid[], $3::timestamp[], $4::varchar[]) AS v(id, until, reason)
      WHERE f."tenantId" = $1 AND f."uploadedFileId" = v.id`,
    [
      tenantId,
      rows.map((r) => r.uploadedFileId),
      rows.map((r) => r.retainUntil),
      rows.map((r) => r.reason.slice(0, REASON_MAX)),
    ],
  ))
}

/** When the tenant's next retained file needs a verdict: the earliest `retainUntil` of its live files, or null when none is left. */
export async function nextPurgeFileDue(tenantId: string): Promise<Date | null> {
  const rows: Array<{ due: Date | string | null }> = await withTenantTransactionFor(tenantId, (qr) => qr.query(
    `SELECT min("retainUntil") AS due FROM uploaded_files WHERE "tenantId" = $1 AND "deletedAt" IS NULL`,
    [tenantId],
  ))
  const due = rows[0]?.due ?? null
  return due === null ? null : new Date(due)
}
