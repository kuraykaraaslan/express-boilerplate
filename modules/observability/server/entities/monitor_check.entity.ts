import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm'

/** One probe sample. High-volume time series — indexed for range/uptime queries
 *  and pruned by retention (raw samples age out; daily uptime summaries persist). */
@Index('idx_monitor_checks_monitor_checked', ['monitorId', 'checkedAt'])
@Entity('monitor_checks')
export class MonitorCheck {
  @PrimaryGeneratedColumn('uuid', { name: 'checkId' })
  checkId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  monitorId!: string

  @Column({ type: 'varchar', length: 8 })
  status!: string

  @Column({ type: 'int', nullable: true })
  latencyMs?: number | null

  @Column({ type: 'int', nullable: true })
  statusCode?: number | null

  @Column({ type: 'varchar', length: 300, nullable: true })
  error?: string | null

  /**
   * Was a tenant maintenance window open when this sample was taken.
   *
   * Recorded so the checks list can say WHY a red row was expected, and so
   * `observabilityExcludeMaintenanceFromUptime` has something to point at. The
   * exclusion itself happens at write time (the daily rollup is not bumped) —
   * this column is the evidence, not the mechanism.
   */
  @Column({ type: 'boolean', default: false })
  duringMaintenance!: boolean

  /** Where the sample was taken (phase 10). Null for samples from before locations existed and for single-location monitors that never set one. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  locationKey?: string | null

  @Index()
  @Column({ type: 'timestamptz' })
  checkedAt!: Date
}
