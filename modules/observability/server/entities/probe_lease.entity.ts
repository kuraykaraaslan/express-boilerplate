import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * The right of one runner to run one monitor's check once (observability phase 10.2). A result is accepted only against a live, unconsumed lease
 * of the runner that sends it, and a lease is consumed by its first accepted result, so a replayed or forged result writes nothing.
 * The lease id is the idempotency key of the result.
 */
@Index('idx_probe_lease_monitor', ['tenantId', 'monitorId', 'locationKey'])
// The cap check counts OUTSTANDING leases (not yet resulted); a partial index keeps that count to the handful of live rows instead of a day of history.
@Index('idx_probe_lease_outstanding', ['expiresAt', 'tenantId'], { where: '"completedAt" IS NULL' })
@Entity('probe_leases')
export class ProbeLease {
  @PrimaryGeneratedColumn('uuid', { name: 'leaseId' })
  leaseId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  monitorId!: string

  @Column({ type: 'varchar', length: 64 })
  locationKey!: string

  @Index()
  @Column({ type: 'uuid' })
  runnerId!: string

  /** The visibility timeout: until then no other runner is given this check; after it, it is due again. */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
