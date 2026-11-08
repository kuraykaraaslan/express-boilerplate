import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Units a quota reservation admitted while Redis could not count them, and units a release could not give back (a negative
 * `units`): lead decision D25 (docs/audits/2026-10-28-lead-decisions.md). A row is a delta for the counters of its `month`
 * and `day`; `reconcileUnbilled` (tenant_usage.unbilled.ts) applies it to Redis once Redis answers again and deletes it in the
 * same transaction, so the month's bill ends where it would have without the outage (an outage that keeps Redis's data: a Redis
 * that restarts empty loses its counters, ledger or not; see the module README).
 *
 * Append-only while pending: one insert per call, no row is ever updated (no lock to wait for on the outage path).
 */
@Index('IDX_tenant_usage_unbilled_tenant_metric_month', ['tenantId', 'metric', 'month'])
@Entity('tenant_usage_unbilled')
export class TenantUsageUnbilledRow {
  @PrimaryGeneratedColumn('uuid', { name: 'unbilledId' })
  unbilledId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 64 })
  metric!: string;

  /** `YYYY-MM` (UTC) of the month counter the units belong to. */
  @Column({ type: 'varchar', length: 7 })
  month!: string;

  /** `YYYY-MM-DD` (UTC) of the day counter the units belong to. */
  @Column({ type: 'varchar', length: 10 })
  day!: string;

  /** Signed: a reservation records what it admitted, a release that could not reach Redis records what it gives back. */
  @Column({ type: 'integer' })
  units!: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
