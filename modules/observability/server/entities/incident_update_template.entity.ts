import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/** A tenant's own wording for a public progress step, per locale (observability phase 14). Defaults live in code; a row overrides them. */
@Index('uq_incident_update_template', ['tenantId', 'status', 'locale'], { unique: true })
@Entity('incident_update_templates')
export class IncidentUpdateTemplate {
  @PrimaryGeneratedColumn('uuid', { name: 'templateId' })
  templateId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** INVESTIGATING | IDENTIFIED | MONITORING | RESOLVED. */
  @Column({ type: 'varchar', length: 14 })
  status!: string

  @Column({ type: 'varchar', length: 12 })
  locale!: string

  @Column({ type: 'varchar', length: 2000 })
  body!: string

  /** `code` when this row is applied from a repository (monitoring-as-code, phase 21): read-only in the UI until it is detached. Null: the UI owns it. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
