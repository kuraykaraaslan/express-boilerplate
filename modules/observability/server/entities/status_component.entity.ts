import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/** A customer-facing service on the status page ("API", "Web", "Payments").
 *  The translation layer of phase 2: customers see components, never monitors —
 *  internal monitor names/targets stay behind this row. `status` is derived
 *  from the linked monitors' worst state, EXCEPT `MAINTENANCE`, which an
 *  operator sets and derivation never overwrites. */
@Index(['tenantId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
@Entity('status_components')
export class StatusComponent {
  @PrimaryGeneratedColumn('uuid', { name: 'componentId' })
  componentId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 200 })
  name!: string

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null

  @Column({ type: 'int', default: 0 })
  order!: number

  /** False = internal-only: never serialized on the public status page. */
  @Column({ type: 'boolean', default: true })
  isPublic!: boolean

  @Column({ type: 'varchar', length: 16, default: 'OPERATIONAL' })
  status!: string

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  /** `code:<key>`: the stable key of a code-managed row (the file's identity for it). Null for rows nobody applied from code. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceKey?: string | null

  /** The one level of grouping (phase 15.2); null = not in a group. */
  @Column({ type: 'uuid', nullable: true })
  groupId?: string | null

  /** Per-component display options (phase 15.2). They only change what the page draws, never what it knows. */
  @Column({ type: 'boolean', default: true })
  showUptime!: boolean

  /** The 90-day bar (phase 15.6). */
  @Column({ type: 'boolean', default: true })
  showHistory!: boolean

  /** Per-region breakdown (phase 10.5): the public page draws the component's status and uptime per EXPOSED, live probe location. */
  @Column({ type: 'boolean', default: false })
  showRegions!: boolean

  /** The response-time chart (phase 15.6): daily average and approximate p95, never a raw check. Off by default. */
  @Column({ type: 'boolean', default: false })
  showResponseTime!: boolean

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
