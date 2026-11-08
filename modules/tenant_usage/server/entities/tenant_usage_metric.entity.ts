import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Unique, Index } from 'typeorm';

/**
 * One counter value per (tenant, period, declared metric) — the open store behind
 * `tenant_usage:metric` (docs/phases/31-feature-gate/02). `tenant_usage` itself keeps its
 * six per-metric columns for one release and the flush job writes both; the read
 * API (`getMetricUsage`) prefers this table.
 *
 * `period` is `YYYY-MM` for a `month` metric and `YYYY-MM-DD` for a `day` metric.
 * `value` is the running total at the last flush (an absolute, not a delta), so a
 * replayed flush is idempotent.
 */
@Unique(['tenantId', 'period', 'metric'])
@Index(['period', 'metric'])
@Entity('tenant_usage_metrics')
export class TenantUsageMetricRow {
  @PrimaryGeneratedColumn('uuid', { name: 'usageMetricId' })
  usageMetricId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 10 })
  period!: string;

  @Column({ type: 'varchar', length: 64 })
  metric!: string;

  @Column({ type: 'bigint', default: 0 })
  value!: string; // bigint comes back as a string from pg

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
