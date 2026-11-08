import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/** An outage record. Opened automatically when a monitor crosses into DOWN and
 *  auto-resolved on recovery; an admin may also open/resolve/re-severity manually.
 *  The partial unique index enforces "at most one OPEN incident per monitor"
 *  (the same single-open-item shape the approval module uses). */
@Index('uq_incident_open_per_monitor', ['tenantId', 'monitorId'], {
  unique: true,
  where: `status = 'OPEN' AND "monitorId" IS NOT NULL`,
})
@Index('idx_incidents_retention', ['tenantId', 'status', 'resolvedAt'])
// Class level: a property-level @Index ignores its column list, so it declared ("alertGroupKey") while migration 002 builds (tenantId, alertGroupKey).
@Index('idx_incidents_alert_group', ['tenantId', 'alertGroupKey'])
@Entity('incidents')
export class Incident {
  @PrimaryGeneratedColumn('uuid', { name: 'incidentId' })
  incidentId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** The monitor that triggered it (null for a purely manual incident). */
  @Column({ type: 'uuid', nullable: true })
  monitorId?: string | null

  /** The first person to acknowledge it, and when. Never overwritten: "who saw it first" is a fact, not a status. */
  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date | null

  @Column({ type: 'uuid', nullable: true })
  acknowledgedBy?: string | null

  /** When the impact stopped but the incident is not yet closed (a fix is out, being watched). */
  @Column({ type: 'timestamptz', nullable: true })
  mitigatedAt?: Date | null

  /** Who declared it (null for an auto-opened incident). */
  @Column({ type: 'uuid', nullable: true })
  declaredBy?: string | null

  /** When the alert pipeline opened it for a group of alerts: that group's key (`alert.grouping.ts`). One OPEN incident per group. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  alertGroupKey?: string | null

  @Column({ type: 'varchar', length: 300 })
  title!: string

  @Column({ type: 'varchar', length: 12, default: 'OPEN' })
  status!: string

  @Column({ type: 'varchar', length: 12, default: 'MAJOR' })
  severity!: string

  /** True when a probe opened it; false when an operator did. */
  @Column({ type: 'boolean', default: false })
  isAuto!: boolean

  /** Default FALSE on purpose (phase 2): an auto-opened incident never reaches
   *  the public status page until an operator publishes it — a false positive
   *  must not show customers a fake outage. */
  @Column({ type: 'boolean', default: false })
  isPublic!: boolean

  /** What the status page says (the internal `reason` may leak internals). */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  publicMessage?: string | null

  /**
   * Status pages of a RESTRICTED audience (password, members, address list) this PRIVATE incident is shown on after their gate passed (phase 15.3).
   * Meaningless while `isPublic` is true (a public incident is on every page it touches); never shown on a PUBLIC page, whatever it holds.
   * Null (never an empty array) = flagged for no page.
   */
  @Column({ type: 'jsonb', nullable: true })
  audiencePageIds?: string[] | null

  /** Status components this incident affects (uuid list; null = none tagged). */
  @Column({ type: 'jsonb', nullable: true })
  affectedComponentIds?: string[] | null

  @Column({ type: 'varchar', length: 1000, nullable: true })
  reason?: string | null

  @Column({ type: 'timestamptz' })
  startedAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null

  /**
   * A legal hold (phase 16.4): while it is set the incident, its timeline, its post-mortem and the alerts linked to it are out of every retention sweep. The
   * reason is mandatory when it is set, so a hold is something somebody answered for; releasing it clears the three fields below.
   */
  @Column({ type: 'boolean', default: false })
  legalHold!: boolean

  @Column({ type: 'varchar', length: 500, nullable: true })
  legalHoldReason?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  legalHoldAt?: Date | null

  @Column({ type: 'uuid', nullable: true })
  legalHoldBy?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
