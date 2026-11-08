import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * @deprecated The wide monthly table (one column per legacy metric). Folded into `tenant_usage_metrics` (docs/phases/42-telemetry/06
 * step 5, migration 002): no longer written; read only by `getMetricUsage`'s last fallback for a month the open table has no row for.
 * Dropped in the next release.
 */
@Unique(['tenantId', 'month'])
@Entity('tenant_usage')
export class TenantUsage {
  @PrimaryGeneratedColumn('uuid', { name: 'usageId' })
  usageId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 7 })
  month!: string; // 'YYYY-MM'

  @Column({ type: 'int', default: 0 })
  apiCalls!: number;

  @Column({ type: 'bigint', default: 0 })
  aiTokens!: number;

  @Column({ type: 'bigint', default: 0 })
  storageBytes!: number;

  @Column({ type: 'int', default: 0 })
  emailSends!: number;

  @Column({ type: 'int', default: 0 })
  smsSends!: number;

  @Column({ type: 'int', default: 0 })
  webhookCalls!: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
