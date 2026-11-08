import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm'
import { BUCKETS_DEFAULT_SQL } from '../uptime.latency-buckets'

/**
 * Daily sample counters PER LOCATION (UTC day), the location dimension of `monitor_check_daily` (observability phase 10.5, decision D-OBS-12).
 *
 * ADDITIVE on purpose: the monitor-level rollup keeps its key `(tenantId, monitorId, day)` and is never rewritten; this table is written in the same
 * transaction by the same call (`StatusUptimeService.bumpDaily`), under the same maintenance-exclusion rule. It has NO backfill: history written
 * before this table existed stays monitor-level only, and the read path says plainly from which day per-location data starts. Never pruned (the
 * retention job prunes raw `monitor_checks` only), for the same reason the monitor-level rollup is kept: it cannot be rebuilt once the raw rows are gone.
 *
 * `locationKey` is the key the sample came from, `local` for the in-process probe (a monitor with no locations is a monitor with one `local` one).
 */
@Entity('monitor_check_daily_location')
@Index('uq_monitor_check_daily_location', ['tenantId', 'monitorId', 'locationKey', 'day'], { unique: true })
export class MonitorCheckDailyLocation {
  @PrimaryGeneratedColumn('uuid', { name: 'dailyLocationId' })
  dailyLocationId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  monitorId!: string

  @Column({ type: 'varchar', length: 64 })
  locationKey!: string

  /** UTC calendar day the counters cover. */
  @Column({ type: 'date' })
  day!: string

  @Column({ type: 'int', default: 0 })
  up!: number

  @Column({ type: 'int', default: 0 })
  degraded!: number

  @Column({ type: 'int', default: 0 })
  down!: number

  @Column({ type: 'int', default: 0 })
  latencyCount!: number

  @Column({ type: 'bigint', default: 0 })
  latencySumMs!: string

  @Column({ type: 'int', array: true, default: () => BUCKETS_DEFAULT_SQL })
  latencyBuckets!: number[]
}
