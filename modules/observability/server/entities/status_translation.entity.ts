import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/**
 * The words of one public thing in one language (observability phase 15.7). `entityType` is a closed set (page, group, component,
 * incident, update); `name` is the translated name or title, `body` the translated description or message. A missing row, or a
 * missing field on a row, falls back to the tenant's primary language and the page says so.
 */
@Entity('status_translations')
@Index('uq_status_translation', ['tenantId', 'entityType', 'entityId', 'locale'], { unique: true })
export class StatusTranslation {
  @PrimaryGeneratedColumn('uuid', { name: 'translationId' })
  translationId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 12 })
  entityType!: string

  @Column({ type: 'uuid' })
  entityId!: string

  @Column({ type: 'varchar', length: 12 })
  locale!: string

  @Column({ type: 'varchar', length: 300, nullable: true })
  name?: string | null

  @Column({ type: 'varchar', length: 2000, nullable: true })
  body?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
