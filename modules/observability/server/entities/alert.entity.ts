import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * A signal that something needs attention (observability phase 11). One row per non-resolved fingerprint: a re-fire updates the row and
 * bumps `count` instead of adding another (the single-open-item shape incidents and device alarms use), so an alert storm is a counter,
 * not a table explosion.
 */
@Index('uq_alert_open_fingerprint', ['tenantId', 'fingerprint'], { unique: true, where: `"status" <> 'RESOLVED'` })
@Index('idx_alerts_tenant_status', ['tenantId', 'status', 'lastFiredAt'])
@Index('idx_alerts_dispatch', ['tenantId', 'status', 'dispatchAfter'])
@Entity('alerts')
export class Alert {
  @PrimaryGeneratedColumn('uuid', { name: 'alertId' })
  alertId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 32 })
  fingerprint!: string

  @Column({ type: 'varchar', length: 12 })
  source!: string

  /** The integration id or module id that sent it. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  sourceRef?: string | null

  @Column({ type: 'varchar', length: 300 })
  title!: string

  @Column({ type: 'varchar', length: 10, default: 'WARNING' })
  severity!: string

  @Column({ type: 'varchar', length: 12, default: 'FIRING' })
  status!: string

  /** Why it is SUPPRESSED: `silence:<id>`, `inhibited:<entity>`, `maintenance`, `dropped`. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  suppressedBy?: string | null

  @Column({ type: 'jsonb', default: () => "'{}'" })
  labels!: Record<string, string>

  @Column({ type: 'jsonb', default: () => "'{}'" })
  annotations!: Record<string, string>

  /** Which alerts travel together (see `alert.grouping.ts`) and which route claimed it. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  groupKey?: string | null

  @Column({ type: 'uuid', nullable: true })
  routeId?: string | null

  @Column({ type: 'timestamptz' })
  startsAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  endsAt?: Date | null

  @Column({ type: 'timestamptz' })
  lastFiredAt!: Date

  @Column({ type: 'int', default: 1 })
  count!: number

  /** Not announced before this time (group wait / group interval); null once announced or when it never will be. */
  @Column({ type: 'timestamptz', nullable: true })
  dispatchAfter?: Date | null

  @Column({ type: 'timestamptz', nullable: true })
  notifiedAt?: Date | null

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date | null

  @Column({ type: 'uuid', nullable: true })
  acknowledgedBy?: string | null

  @Index()
  @Column({ type: 'uuid', nullable: true })
  incidentId?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
