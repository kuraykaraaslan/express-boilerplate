import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index,
} from 'typeorm'

/** An active uptime probe target: the OUTWARD counterpart to health.route (which
 *  reports our own health). One row = one thing we ping on a schedule. */
@Index(['tenantId', 'isActive'])
@Index(['tenantId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
@Index('uq_monitors_heartbeat_token', ['heartbeatTokenHash'], { unique: true, where: '"heartbeatTokenHash" IS NOT NULL' })
@Entity('monitors')
export class Monitor {
  @PrimaryGeneratedColumn('uuid', { name: 'monitorId' })
  monitorId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 200 })
  name!: string

  @Column({ type: 'varchar', length: 16, default: 'HTTP' })
  type!: string

  /** URL for HTTP, host:port for TCP, host for PING/DNS. */
  @Column({ type: 'varchar', length: 500 })
  target!: string

  @Column({ type: 'int', default: 60 })
  intervalSeconds!: number

  @Column({ type: 'int', default: 10000 })
  timeoutMs!: number

  /** Expected HTTP status (null = any 2xx counts as up). */
  @Column({ type: 'int', nullable: true })
  expectedStatus?: number | null

  /** Substring the response body must contain to count as up (null = skip). */
  @Column({ type: 'varchar', length: 500, nullable: true })
  expectedBodyContains?: string | null

  /** Latency above this marks the sample DEGRADED (still up). null = no ceiling. */
  @Column({ type: 'int', nullable: true })
  degradedLatencyMs?: number | null

  /**
   * Typed assertions (`uptime.assertions.ts`): status set, header, body, JSONPath, latency budget, size. `expectedStatus` and
   * `expectedBodyContains` above keep working and are read as assertions of their own, so existing monitors need no migration of meaning.
   */
  @Column({ type: 'jsonb', nullable: true })
  assertions?: unknown[] | null

  /** TLS / DOMAIN / HTTPS expiry thresholds in days: at or under `certWarnDays` the sample is DEGRADED, at or under `certCriticalDays` it is DOWN. */
  @Column({ type: 'int', nullable: true })
  certWarnDays?: number | null

  @Column({ type: 'int', nullable: true })
  certCriticalDays?: number | null

  /** HEARTBEAT: SHA-256 of the push token (the token is a credential — only its hash is stored) and the grace added to `intervalSeconds`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  heartbeatTokenHash?: string | null

  @Column({ type: 'int', nullable: true })
  heartbeatGraceSeconds?: number | null

  @Column({ type: 'timestamptz', nullable: true })
  lastHeartbeatAt?: Date | null

  /** HEARTBEAT `/start` signal time and the last reported job state, so a job's duration and an explicit failure are visible. */
  @Column({ type: 'timestamptz', nullable: true })
  heartbeatStartedAt?: Date | null

  @Column({ type: 'varchar', length: 8, nullable: true })
  heartbeatState?: string | null

  /** STEPS: the closed step list (`uptime.probe.steps.ts`) and the AES-encrypted secrets those steps may reference as `{{secret.NAME}}`. */
  @Column({ type: 'jsonb', nullable: true })
  steps?: unknown[] | null

  @Column({ type: 'jsonb', nullable: true })
  secrets?: Record<string, string> | null

  /** BROWSER: the closed browser step grammar with its budgets (`uptime.browser.schema.ts`). Runs only in a browser-capable probe runner; secrets are the same sealed map as STEPS. */
  @Column({ type: 'jsonb', nullable: true })
  browser?: Record<string, unknown> | null

  /** Optional latency baseline: DEGRADED when a sample exceeds the rolling median by this factor (null = off). */
  @Column({ type: 'real', nullable: true })
  latencyBaselineFactor?: number | null

  /** Organisation: a free-text group and tags. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  groupName?: string | null

  @Column({ type: 'jsonb', nullable: true })
  tags?: string[] | null

  /** Probes are skipped until this time (pause-until). `isActive` is the permanent switch; this one expires by itself. */
  @Column({ type: 'timestamptz', nullable: true })
  pausedUntil?: Date | null

  /** A per-monitor maintenance window: samples are recorded as `duringMaintenance` and open no incident until this time. */
  @Column({ type: 'timestamptz', nullable: true })
  maintenanceUntil?: Date | null

  /** Request headers (e.g. an auth token). Secret — never surfaced on a public page. */
  @Column({ type: 'jsonb', nullable: true })
  headers?: Record<string, string> | null

  @Column({ type: 'boolean', default: true })
  isActive!: boolean

  /**
   * Set when a module contributed this monitor through `observability:probe-target` (`<moduleId>:<key>`); null for operator-defined ones. The
   * contributing provider owns such a row's identity and target — sync rewrites them and deactivates the row when the provider stops reporting it. `code:<key>` marks a monitor applied from a repository
   * (phase 21, with `managedBy` = 'code'); the provider sync never touches those because `code` is not a module id.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceKey?: string | null

  /**
   * Where this monitor runs from (phase 10): location keys, `local` being the in-process probe. Null or empty = `local` only, which is what every
   * monitor did before locations existed, so nothing regresses.
   */
  @Column({ type: 'jsonb', nullable: true })
  locations?: string[] | null

  /** How many locations must be DOWN for the monitor to be DOWN. Null = a majority of the locations that report. */
  @Column({ type: 'int', nullable: true })
  quorum?: number | null

  /** Debounced state per location, `{ [key]: { status, consecutiveFailures, consecutiveSuccesses, at } }`. Only used when there are two or more locations. */
  @Column({ type: 'jsonb', nullable: true })
  locationState?: Record<string, { status: string; consecutiveFailures: number; consecutiveSuccesses: number; at: string; latencyMs?: number | null; error?: string | null }> | null

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  /** DOWN is only declared after this many consecutive failures (default 3). */
  @Column({ type: 'int', default: 3 })
  consecutiveFailThreshold!: number

  @Column({ type: 'varchar', length: 8, default: 'UNKNOWN' })
  lastStatus!: string

  /** Running counters that drive the debounce (reset on the opposite outcome). */
  @Column({ type: 'int', default: 0 })
  consecutiveFailures!: number

  @Column({ type: 'int', default: 0 })
  consecutiveSuccesses!: number

  @Column({ type: 'timestamptz', nullable: true })
  lastCheckedAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}
