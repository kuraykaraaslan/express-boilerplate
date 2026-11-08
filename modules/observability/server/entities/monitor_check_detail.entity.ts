import 'reflect-metadata'
import { Entity, PrimaryColumn, Column, Index, CreateDateColumn } from 'typeorm'

/**
 * What a BROWSER sample carries beyond the sample itself (D-OBS-8): the bounded per-step timings and web-vitals of the run (`detail`, a few KB) and, for a failed run,
 * one capped JPEG screenshot (`screenshot`, at most 300 KB, written by the control plane after it checked the bytes).
 *
 * One row per sample (`checkId` is the sample's id), tenant-partitioned like every other row, and pruned by the same retention pass as the raw checks: `checkedAt` is the
 * sample's own time, so "the raw-check retention" and "the screenshot retention" are one cutoff. `screenshot` is never selected by a list query (`select: false`): only the
 * screenshot route reads it, behind its own permission.
 */
@Index('idx_monitor_check_details_monitor', ['tenantId', 'monitorId', 'checkedAt'])
@Index('idx_monitor_check_details_location', ['tenantId', 'monitorId', 'locationKey', 'checkedAt'])
@Entity('monitor_check_details')
export class MonitorCheckDetail {
  @PrimaryColumn({ type: 'uuid' })
  checkId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  monitorId!: string

  /** The sample's own time: retention prunes on it. */
  @Index()
  @Column({ type: 'timestamptz' })
  checkedAt!: Date

  /**
   * Where the sample was taken (42-telemetry/04 §4.1): with the sample's own time this names the sample once `monitor_checks` and its
   * `checkId` are gone (release N+1); null for rows written before the column existed and for the in-process probe.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  locationKey?: string | null

  /** Bounded record of the run (`BrowserDetail`, at most 8,000 characters of JSON). */
  @Column({ type: 'jsonb' })
  detail!: Record<string, unknown>

  /** A JPEG of the page at the failing step, or null. Never returned by a list query. */
  @Column({ type: 'bytea', nullable: true, select: false })
  screenshot?: Buffer | null

  @Column({ type: 'int', nullable: true })
  screenshotBytes?: number | null

  /** SHA-256 of the stored bytes (hex): what the response's ETag is, and the evidence the picture was not swapped. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  screenshotSha256?: string | null

  /** The step that was running when the screenshot was taken. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  screenshotStep?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
