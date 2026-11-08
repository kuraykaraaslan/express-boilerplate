import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm'
import { BUCKETS_DEFAULT_SQL } from '../uptime.latency-buckets'

/** Daily per-monitor sample counters (UTC day), incremented on every probe
 *  write. This is what makes 30/90-day uptime computable FOREVER: raw
 *  `monitor_checks` age out under retention, and a summary can never be
 *  rebuilt from data that no longer exists. */
@Entity('monitor_check_daily')
@Index('uq_monitor_check_daily', ['tenantId', 'monitorId', 'day'], { unique: true })
export class MonitorCheckDaily {
  @PrimaryGeneratedColumn('uuid', { name: 'dailyId' })
  dailyId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Index()
  @Column({ type: 'uuid' })
  monitorId!: string

  /** UTC calendar day the counters cover. */
  @Column({ type: 'date' })
  day!: string

  @Column({ type: 'int', default: 0 })
  up!: number

  @Column({ type: 'int', default: 0 })
  degraded!: number

  @Column({ type: 'int', default: 0 })
  down!: number

  /** Samples of the day that measured a latency (UP and DEGRADED). Phase 15.6: the response-time chart; see `uptime.latency-buckets.ts`. */
  @Column({ type: 'int', default: 0 })
  latencyCount!: number

  /** Sum of those latencies in whole ms (bigint: it arrives as a string). The average is `latencySumMs / latencyCount`, exact. */
  @Column({ type: 'bigint', default: 0 })
  latencySumMs!: string

  /** One counter per fixed latency bucket (`LATENCY_BUCKET_EDGES_MS` + overflow): the source of the approximate p95. */
  @Column({ type: 'int', array: true, default: () => BUCKETS_DEFAULT_SQL })
  latencyBuckets!: number[]
}
