import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * A named, reusable silence (observability phase 21): the matchers, a length and a reason, kept in a repository and applied with
 * monitoring-as-code. It is NOT a silence: nothing is muted until somebody starts it (`POST /api/alert-silence-templates`), which creates a
 * normal, time-bound `AlertSilence` through the same service as the console.
 */
@Index(['tenantId', 'sourceKey'], { unique: true, where: '"sourceKey" IS NOT NULL' })
@Entity('alert_silence_templates')
export class AlertSilenceTemplate {
  @PrimaryGeneratedColumn('uuid', { name: 'templateId' })
  templateId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'varchar', length: 120 })
  name!: string

  @Column({ type: 'jsonb', default: () => "'[]'" })
  matchers!: unknown[]

  @Column({ type: 'int' })
  durationMinutes!: number

  @Column({ type: 'varchar', length: 500 })
  reason!: string

  /** `code` when applied from a repository; null once detached. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  managedBy?: string | null

  /** `code:<key>`. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceKey?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
