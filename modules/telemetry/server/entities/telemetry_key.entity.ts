import 'reflect-metadata';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The per-tenant telemetry key dictionary (00 P0-T-02): a key name of a tenant and its global int4 id, which the raw rows
 * (`numKeyIds`), the latest values and the 1-minute aggregates store instead of the name. Keys are never renamed or reused, so a
 * cached id cannot go stale. Created by migration 001 (`synchronize: false`, the unique key is the migration's).
 */
@Entity({ name: 'telemetry_keys', synchronize: false })
export class TelemetryKey {
  @PrimaryGeneratedColumn('identity', { generatedIdentity: 'ALWAYS' })
  keyId!: number;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The protocol key rule (`^[A-Za-z0-9_.\-]{1,64}$`); the column is wider on purpose (00 P0-T-02). */
  @Column({ type: 'varchar', length: 255 })
  key!: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  firstSeenAt!: Date;
}
