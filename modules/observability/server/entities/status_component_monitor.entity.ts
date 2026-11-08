import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/** Component ↔ monitor many-to-many link. The critical separation lives here:
 *  a public page serializes the COMPONENT side only — this row (and through it
 *  the monitor's name/target/headers) must never cross the public boundary. */
@Entity('status_component_monitors')
@Index('uq_status_component_monitor', ['tenantId', 'componentId', 'monitorId'], { unique: true })
export class StatusComponentMonitor {
  @PrimaryGeneratedColumn('uuid', { name: 'linkId' })
  linkId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Index()
  @Column({ type: 'uuid' })
  componentId!: string

  @Index()
  @Column({ type: 'uuid' })
  monitorId!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
