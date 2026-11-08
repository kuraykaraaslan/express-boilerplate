import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * One row per tenant, UTC day and kind of the daily metering reconciliation (phase 16.3, `observability.reconcile.ts`): what the meter says, what the
 * raw table says, and whether they agree within the tolerance. Written once per day per kind (idempotent on the unique key: a second run of the same day
 * overwrites its own row), kept for 90 days by the retention sweep. `detail` carries the split (by check type and location, by alert source, ...).
 */
@Index('uq_observability_reconciliation', ['tenantId', 'day', 'kind'], { unique: true })
@Entity('observability_reconciliations')
export class ObservabilityReconciliation {
  @PrimaryGeneratedColumn('uuid', { name: 'reconcileId' })
  reconcileId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** The UTC day that was reconciled. */
  @Column({ type: 'date' })
  day!: string

  /** `probe_runs`, `alerts`, `sms_pages`, `voice_pages`. */
  @Column({ type: 'varchar', length: 24 })
  kind!: string

  /** What the meter's events add up to for the day (null when the metering module is not active). */
  @Column({ type: 'int', nullable: true })
  metered?: number | null

  /** What the raw table holds for the day. */
  @Column({ type: 'int' })
  actual!: number

  /** `OK` within tolerance, `DIVERGED` beyond it, `SKIPPED` when one side could not be read (never reported as OK). */
  @Column({ type: 'varchar', length: 10 })
  status!: string

  /** metered - actual, signed. */
  @Column({ type: 'int', default: 0 })
  difference!: number

  @Column({ type: 'jsonb', nullable: true })
  detail?: Record<string, unknown> | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
