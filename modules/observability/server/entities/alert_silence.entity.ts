import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * A time-bound mute (observability phase 11). A silence stops an alert from being ANNOUNCED; the alert is still stored (as SUPPRESSED),
 * so nothing is hidden from the record. A reason is required and a silence cannot last longer than 30 days.
 */
@Index('idx_alert_silences_active', ['tenantId', 'endsAt'])
@Entity('alert_silences')
export class AlertSilence {
  @PrimaryGeneratedColumn('uuid', { name: 'silenceId' })
  silenceId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'jsonb' })
  matchers!: unknown[]

  @Column({ type: 'timestamptz' })
  startsAt!: Date

  @Column({ type: 'timestamptz' })
  endsAt!: Date

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string | null

  @Column({ type: 'varchar', length: 500 })
  reason!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
