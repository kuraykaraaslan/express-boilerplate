import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * A service level objective (observability phase 13): "this share of events must be good over this window".
 *
 * What counts as an event depends on the SLI `kind`: monitor samples that were up (`MONITOR_AVAILABILITY`), monitor samples that were up
 * and fast enough (`MONITOR_LATENCY`), or two metric queries, good and total, on the platform plane (`METRIC_RATIO`, ROOT tenant only:
 * tenants never submit raw metric queries). `lastState` remembers where the budget stood at the last evaluation, so the budget-low and
 * budget-exhausted events fire on the TRANSITION and not every minute.
 */
@Index('idx_slos_tenant_active', ['tenantId', 'isActive'])
@Index(['tenantId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
@Entity('slos')
export class Slo {
  @PrimaryGeneratedColumn('uuid', { name: 'sloId' })
  sloId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 200 })
  name!: string

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null

  @Column({ type: 'varchar', length: 24, default: 'MONITOR_AVAILABILITY' })
  kind!: string

  /** 99.9 means 99.9 %. */
  @Column({ type: 'numeric', precision: 6, scale: 3, default: 99.9, transformer: { to: (v: number) => v, from: (v: string | number) => Number(v) } })
  objectivePercent!: number

  /** Rolling window in days: 7, 28, 30 or 90. */
  @Column({ type: 'int', default: 30 })
  windowDays!: number

  /** The monitors whose samples are the events. Ignored when `componentId` is set (that component's monitors are used instead). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  monitorIds!: string[]

  @Column({ type: 'uuid', nullable: true })
  componentId?: string | null

  /** `MONITOR_LATENCY`: a sample is good when it is up and answered within this many milliseconds. */
  @Column({ type: 'int', nullable: true })
  latencyThresholdMs?: number | null

  /** `METRIC_RATIO` (ROOT only): `{ goodQuery, totalQuery }`, evaluated over a window by the metrics source. */
  @Column({ type: 'jsonb', nullable: true })
  metricSpec?: { goodQuery: string; totalQuery: string } | null

  /** The remaining-budget share under which the state reads LOW (and the `slo.budget_low` event fires). */
  @Column({ type: 'int', default: 25 })
  lowBudgetPercent!: number

  /** Raise burn-rate alerts for this SLO. */
  @Column({ type: 'boolean', default: true })
  burnAlerts!: boolean

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  /** `code:<key>`: the stable key of a code-managed row (the file's identity for it). Null for rows nobody applied from code. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceKey?: string | null

  @Column({ type: 'uuid', nullable: true })
  ownerUserId?: string | null

  /** `OK` | `LOW` | `EXHAUSTED` | `NO_DATA` at the last evaluation. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  lastState?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  lastEvaluatedAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
