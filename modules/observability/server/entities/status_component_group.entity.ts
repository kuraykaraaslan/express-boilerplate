import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/** One level of grouping for status components (observability phase 15.2): "Core", "Payments", "Integrations". A group has no parent. */
@Entity('status_component_groups')
export class StatusComponentGroup {
  @PrimaryGeneratedColumn('uuid', { name: 'groupId' })
  groupId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 200 })
  name!: string

  @Column({ type: 'varchar', length: 500, nullable: true })
  description?: string | null

  @Column({ type: 'int', default: 0 })
  order!: number

  /** Whether the group starts collapsed on the page. */
  @Column({ type: 'boolean', default: false })
  collapsed!: boolean

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
