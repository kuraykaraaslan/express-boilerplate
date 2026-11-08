import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Check } from 'typeorm';

/**
 * Lifecycle of a dedicated tenant database. Routing (`tenantDataSourceFor`) serves `ACTIVE` only; the deploy fan-out
 * migrates every database that still exists (`PROVISIONING` and `ACTIVE`); the retention sweep skips `DROPPED`.
 */
export const TENANT_DATABASE_STATUSES = ['PROVISIONING', 'ACTIVE', 'DROPPED'] as const;
export type TenantDatabaseStatus = (typeof TENANT_DATABASE_STATUSES)[number];

/**
 * Where a tenant's data physically lives (cross-tenant by design, RLS-exempt).
 *
 * db.02 (contract, decided 2026-10-21): the DSN is stored ENCRYPTED only (`databaseUrlEnc`, AES-GCM field encryption, see
 * db.tenant-database.url.ts). The plaintext `databaseUrl` column is gone: the deploy backfills every row's ciphertext first
 * and refuses to continue while any row would still depend on its plaintext (db.tenant-database.backfill.ts
 * `assertPlaintextDropSafe`), then `synchronize` (single role) or migration 007 (migrate mode) drops the column. There is no
 * plaintext fallback for a rolled-back release: by decision, no one-release staging.
 */
@Entity('tenant_databases')
// Named so the SQL migration (which adds them to databases that predate the columns) and `synchronize` agree on one
// constraint; a CHECK that only the migration knew would be dropped again by the next synchronize.
@Check('ck_tenant_databases_status', `"status" IN ('PROVISIONING', 'ACTIVE', 'DROPPED')`)
@Check('ck_tenant_databases_has_url', `"databaseUrlEnc" IS NOT NULL`)
export class TenantDatabase {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  /** `v1.<iv>.<ciphertext>.<tag>` of the DSN (common/server/field-encryption.ts). Required (the CHECK above). */
  @Column({ type: 'text', nullable: true })
  databaseUrlEnc!: string | null;

  /** Region the database lives in (a fleet region id), or null when the deployment has no regions. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  regionId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ACTIVE' })
  status!: TenantDatabaseStatus;

  /** The code schema version (db.schema-version.ts) this database was last migrated to by the deploy fan-out. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  schemaVersion!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
