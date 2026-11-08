import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'
import type { TargetPolicy } from '../probe.policy'

/**
 * A place probes run from (observability phase 10.1).
 *
 * PUBLIC locations are published by the ROOT tenant: the rows live in the ROOT tenant and every tenant reads them through the root catalogue
 * (no nullable-tenantId row is invented). PRIVATE locations belong to one tenant and carry the target allow-list that tenant declared.
 * `local` is never a row: it is the implicit in-process probe every monitor already has.
 */
@Index('uq_probe_location_key', ['tenantId', 'key'], { unique: true })
@Entity('probe_locations')
export class ProbeLocation {
  @PrimaryGeneratedColumn('uuid', { name: 'locationId' })
  locationId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 64 })
  key!: string

  /** `PUBLIC` | `PRIVATE`. */
  @Column({ type: 'varchar', length: 8 })
  kind!: string

  @Column({ type: 'varchar', length: 120 })
  label!: string

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  /** PRIVATE only: the CIDRs and hostnames this location's runner may be given. Empty allows nothing. */
  @Column({ type: 'jsonb', nullable: true })
  targetPolicy?: TargetPolicy | null

  /**
   * BROWSER checks may be placed here. A PUBLIC location is browser-capable only when the ROOT tenant has explicitly enabled it (a browser is expensive); a PRIVATE one is the
   * tenant's own runner, so it is allowed without the flag. A location with the flag set REQUIRES its runners to report the `browser` capability when they enrol.
   */
  @Column({ type: 'boolean', default: false })
  browserEnabled!: boolean

  /** Newest heartbeat of any runner of this location; a location with no recent one is hidden from the picker (no fake regions). */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null

  @Column({ type: 'varchar', length: 40, nullable: true })
  version?: string | null

  /**
   * Whether this location may appear on a PUBLIC status page (phase 10.5 / 15.2). Null = the default of its kind: a PUBLIC catalogue location
   * (the ROOT tenant already published its key and label to every tenant) is visible, a PRIVATE one is not. A PRIVATE location is only ever
   * exposed by an explicit `true` set with the status-publish permission, and only under its `publicLabel`.
   */
  @Column({ type: 'boolean', nullable: true })
  publicVisible?: boolean | null

  /** The name a status page shows for this location. A PRIVATE location with no public label is never shown (its internal label may say too much). */
  @Column({ type: 'varchar', length: 120, nullable: true })
  publicLabel?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
