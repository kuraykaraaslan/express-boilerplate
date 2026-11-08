import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/** `child` cannot be healthy while `parent` is down (observability phase 11). Entities are opaque keys: `component:<id>`, `process:<kind>`, `monitor:<id>`. */
@Index('uq_alert_dependency', ['tenantId', 'child', 'parent'], { unique: true })
@Entity('alert_dependencies')
export class AlertDependency {
  @PrimaryGeneratedColumn('uuid', { name: 'dependencyId' })
  dependencyId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 140 })
  child!: string

  @Column({ type: 'varchar', length: 140 })
  parent!: string

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
