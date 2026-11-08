import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * A single-use, short-lived credential that lets ONE runner enrol into ONE location (observability phase 10.2). Only its hash is stored and it
 * is shown once. Using it consumes it; an expired or used token answers the same 404 as one that never existed.
 */
@Index('uq_probe_enrolment_token', ['tokenHash'], { unique: true })
@Entity('probe_enrolments')
export class ProbeEnrolment {
  @PrimaryGeneratedColumn('uuid', { name: 'enrolmentId' })
  enrolmentId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  locationId!: string

  @Column({ type: 'varchar', length: 64 })
  locationKey!: string

  @Column({ type: 'varchar', length: 64 })
  tokenHash!: string

  @Column({ type: 'timestamptz' })
  expiresAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  usedAt?: Date | null

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
