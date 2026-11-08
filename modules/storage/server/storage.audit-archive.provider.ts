import { S3Client } from '@aws-sdk/client-s3';
import { env } from '@kuraykaraaslan-labs/env';
import type { AuditArchiveExporter } from '@kuraykaraaslan-labs/audit_log/server/audit_log.types';
import { createS3ArchiveExporter } from './storage.audit-archive';

/**
 * Contribution to `audit_log:archive_exporter`: the S3 Object Lock archive, when AUDIT_ARCHIVE_BUCKET is set. Not configured (no bucket) answers null, which the
 * purge sweep reads as "no archive"; a bucket without a retention period is a configuration error and THROWS, so a half-configured archive fails closed instead of
 * silently archiving nothing. Credentials come from the AWS provider chain (environment, instance role, SSO), the same as the SDK everywhere else.
 */
let cached: { key: string; exporter: AuditArchiveExporter } | null = null;

export default async function auditArchiveExporter(): Promise<AuditArchiveExporter | null> {
  const bucket = env.AUDIT_ARCHIVE_BUCKET?.trim();
  if (!bucket) return null;
  const retentionDays = env.AUDIT_ARCHIVE_RETENTION_DAYS;
  if (!retentionDays) throw new Error('AUDIT_ARCHIVE_BUCKET is set but AUDIT_ARCHIVE_RETENTION_DAYS is not');
  const key = [bucket, env.AUDIT_ARCHIVE_PREFIX, env.AUDIT_ARCHIVE_REGION, env.AUDIT_ARCHIVE_ENDPOINT, retentionDays, env.AUDIT_ARCHIVE_LOCK_MODE].join('|');
  if (cached?.key === key) return cached.exporter;   // keeps the "object lock verified" state across sweeps
  const client = new S3Client({
    region: env.AUDIT_ARCHIVE_REGION || env.AWS_REGION || env.AWS_S3_REGION || 'us-east-1',
    ...(env.AUDIT_ARCHIVE_ENDPOINT ? { endpoint: env.AUDIT_ARCHIVE_ENDPOINT, forcePathStyle: true } : {}),
  });
  const exporter = createS3ArchiveExporter({ client, bucket, prefix: env.AUDIT_ARCHIVE_PREFIX, retentionDays, mode: env.AUDIT_ARCHIVE_LOCK_MODE });
  cached = { key, exporter };
  return exporter;
}
