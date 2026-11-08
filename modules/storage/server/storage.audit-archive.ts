import { createHash, randomUUID } from 'node:crypto';
import {
  GetObjectLockConfigurationCommand, PutObjectCommand, type ObjectLockMode, type S3Client,
} from '@aws-sdk/client-s3';
import type { AuditArchiveExporter } from '@kuraykaraaslan-labs/audit_log/server/audit_log.types';

/**
 * Write-once archive of audit rows (docs/phases/02-fleet/04-security-model.md section 7, "Export"): the rows of a retention purge go to an S3 bucket created WITH
 * Object Lock before they are deleted from the database, so the archive cannot be altered or removed by anyone, the application's own credentials included, until
 * its retention date.
 *
 * Fail closed, in three places, because an archive that is not really write-once is worse than none (it looks like a guarantee):
 *  - the bucket must report Object Lock as enabled (`GetObjectLockConfiguration`), checked before the first write and remembered only while it holds;
 *  - every object is written with a lock mode and a retain-until date, and is refused rather than overwritten (`If-None-Match: *`);
 *  - the content is bound to its SHA-256 (`ChecksumSHA256`), so the store refuses a body that arrived altered.
 * An error is rethrown WITHOUT the store's message (it can name the bucket, a request id, a principal): the sweep logs the error name only.
 *
 * The object holds the NDJSON the audit module serialised: stored rows, pseudonymous (`actorRef`, never a resolved identity). The key carries the tenant, the day
 * and a random id, so two purges of one tenant never collide and an operator can find a tenant's archive without reading any object.
 */
export interface S3ArchiveOptions {
  client: Pick<S3Client, 'send'>;
  bucket: string;
  /** Key prefix, without a leading or trailing slash. */
  prefix?: string;
  retentionDays: number;
  mode?: ObjectLockMode;
  /** Server-side encryption of the object: AES256 unless the operator needs a KMS key (not configurable here: the bucket default applies on top). */
  now?: () => Date;
  newId?: () => string;
}

export class ArchiveWriteError extends Error {
  constructor(public readonly code: string) { super(`audit archive write failed (${code})`); this.name = 'ArchiveWriteError'; }
}

const errorName = (e: unknown): string => (e instanceof Error && e.name && e.name !== 'Error' ? e.name : 'Unknown');
const DAY_MS = 24 * 3_600_000;

/** `prefix/tenantId/YYYY-MM-DD/<id>.ndjson`: no tenant data in the name beyond the tenant id. */
export function archiveKey(prefix: string | undefined, tenantId: string, at: Date, id: string): string {
  const clean = (prefix ?? '').replace(/^\/+|\/+$/g, '');
  return `${clean ? `${clean}/` : ''}${tenantId}/${at.toISOString().slice(0, 10)}/${id}.ndjson`;
}

export function createS3ArchiveExporter(o: S3ArchiveOptions): AuditArchiveExporter {
  const now = o.now ?? (() => new Date());
  const newId = o.newId ?? randomUUID;
  const mode: ObjectLockMode = o.mode ?? 'COMPLIANCE';
  let verified = false;

  async function assertObjectLock(): Promise<void> {
    if (verified) return;
    let enabled: string | undefined;
    try {
      const res = await o.client.send(new GetObjectLockConfigurationCommand({ Bucket: o.bucket }));
      enabled = res.ObjectLockConfiguration?.ObjectLockEnabled;
    } catch (e) { throw new ArchiveWriteError(`object-lock-check:${errorName(e)}`); }
    if (enabled !== 'Enabled') throw new ArchiveWriteError('object-lock-disabled');
    verified = true;
  }

  return {
    async export(tenantId, ndjson, rowCount) {
      await assertObjectLock();
      const at = now();
      const body = Buffer.from(ndjson, 'utf8');
      try {
        await o.client.send(new PutObjectCommand({
          Bucket: o.bucket,
          Key: archiveKey(o.prefix, tenantId, at, newId()),
          Body: body,
          ContentType: 'application/x-ndjson',
          ContentLength: body.length,
          ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
          ObjectLockMode: mode,
          ObjectLockRetainUntilDate: new Date(at.getTime() + o.retentionDays * DAY_MS),
          IfNoneMatch: '*',
          ServerSideEncryption: 'AES256',
          Metadata: { rows: String(rowCount) },
        }));
      } catch (e) {
        // The lock may have been switched off or the bucket replaced since the check: do not trust it again.
        verified = false;
        throw new ArchiveWriteError(errorName(e));
      }
    },
  };
}
