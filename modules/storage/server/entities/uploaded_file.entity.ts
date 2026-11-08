import 'reflect-metadata';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * Persistent audit row for every successful upload through StorageService.
 *
 * - Created by `StorageService.uploadFile` / `uploadFromUrl` after the
 *   provider returns a successful `ProviderUploadResult`.
 * - Soft-deleted by `StorageService.deleteFile` (we keep the row for audit;
 *   the bytes are gone from the S3-compatible bucket).
 * - Joined with `TenantUsage.storageBytes` for billing / quota.
 */
@Entity('uploaded_files')
export class UploadedFile {
  @PrimaryGeneratedColumn('uuid', { name: 'uploadedFileId' })
  uploadedFileId!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ nullable: true, type: 'uuid' })
  userId?: string;

  @Index()
  @Column({ type: 'varchar' })
  key!: string; // S3 / R2 / Spaces / MinIO object key

  @Column({ type: 'varchar' })
  bucket!: string;

  @Column({ type: 'varchar' })
  provider!: string; // aws-s3, cloudflare-r2, digitalocean-spaces, minio

  @Column({ type: 'bigint' })
  size!: number;

  @Column({ type: 'varchar' })
  mimeType!: string;

  @Column({ nullable: true, type: 'varchar' })
  url?: string;

  // ── Upload origin (fraud / GDPR audit: "who uploaded this, from where?") ────
  @Column({ nullable: true, type: 'varchar' })
  ipAddress?: string;

  @Column({ nullable: true, type: 'varchar' })
  userAgent?: string;

  @Index()
  @Column({ nullable: true, type: 'varchar' })
  country?: string; // ISO country code inferred from the IP

  /**
   * Whose storage account holds the object (docs/phases/53-setting-levels, 53.5): 'platform' (the root tenant's provider, counted
   * against the plan's storage) or 'tenant' (the tenant's own). Reads and deletes go to that side even after the module's setting
   * level changes. Null for objects stored before: they follow the provider in force, as they always did.
   */
  @Column({ nullable: true, type: 'varchar', length: 16 })
  source?: 'platform' | 'tenant' | null;

  // ── Virus scan ────────────────────────────────────────────────────────────
  // skipped (scanning off) | pending (queued) | clean | infected | error
  @Index()
  @Column({ type: 'varchar', default: 'skipped' })
  scanStatus!: string;

  @Column({ nullable: true, type: 'varchar' })
  scanProvider?: string; // e.g. 'virustotal'

  @Column({ nullable: true, type: 'text' })
  scanResult?: string; // threat name / engine summary

  @Column({ nullable: true, type: 'timestamp' })
  scannedAt?: Date;

  // ── Retention after a tenant purge (docs/phases/37-extensions/11) ─────────
  // Null while the tenant lives. The purge stamps every file of the tenant, then
  // keeps the ones a module must still retain (`tenant:purge_retention`) with the
  // date their retention ends and deletes the rest; the daily sweep asks again
  // once the date has passed. See storage.purge-retention.ts.
  @Column({ nullable: true, type: 'timestamp' })
  retainUntil?: Date | null;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  retentionReason?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
