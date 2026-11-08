import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/**
 * A component's auto-post and auto-resolve wording (observability phase 15.10). When the component's status gets worse than
 * OPERATIONAL, an incident is drafted from `postTitle` / `postMessage`; when it is OPERATIONAL again, the draft is resolved with
 * `resolveMessage`. The draft is PRIVATE unless `autoPublish` is on, and turning that on takes the `observability.status.publish`
 * permission: the machine never publishes on a tenant's behalf unless somebody who may publish said it could.
 */
@Entity('status_automations')
@Index('uq_status_automation_component', ['tenantId', 'componentId'], { unique: true })
export class StatusAutomation {
  @PrimaryGeneratedColumn('uuid', { name: 'automationId' })
  automationId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  componentId!: string

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  /** The component status that starts a post: DEGRADED | PARTIAL_OUTAGE | MAJOR_OUTAGE (this one or worse). */
  @Column({ type: 'varchar', length: 16, default: 'PARTIAL_OUTAGE' })
  minStatus!: string

  @Column({ type: 'varchar', length: 300 })
  postTitle!: string

  @Column({ type: 'varchar', length: 2000 })
  postMessage!: string

  @Column({ type: 'varchar', length: 2000, nullable: true })
  resolveMessage?: string | null

  @Column({ type: 'varchar', length: 12, default: 'MAJOR' })
  severity!: string

  @Column({ type: 'boolean', default: true })
  autoResolve!: boolean

  /** False = the draft stays private until a person publishes it (the default). */
  @Column({ type: 'boolean', default: false })
  autoPublish!: boolean

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
