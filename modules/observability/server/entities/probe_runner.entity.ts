import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm'

/**
 * An enrolled probe runner (observability phase 10.2). Only the PUBLIC key is stored: the private key was generated on the runner's host and never
 * left it, so a database leak cannot be used to impersonate a runner. Revoking is immediate: a revoked runner's next request is a 401.
 */
@Index('uq_probe_runner_fingerprint', ['fingerprint'], { unique: true })
@Entity('probe_runners')
export class ProbeRunner {
  @PrimaryGeneratedColumn('uuid', { name: 'runnerId' })
  runnerId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  @Column({ type: 'uuid' })
  locationId!: string

  @Column({ type: 'varchar', length: 64 })
  locationKey!: string

  @Column({ type: 'varchar', length: 120 })
  name!: string

  @Column({ type: 'text' })
  publicKeyPem!: string

  @Column({ type: 'varchar', length: 64 })
  fingerprint!: string

  /** `ACTIVE` | `REVOKED`. */
  @Column({ type: 'varchar', length: 8, default: 'ACTIVE' })
  status!: string

  @Column({ type: 'varchar', length: 40, nullable: true })
  version?: string | null

  /** What this runner says it can do (`browser`). Reported at enrolment and on every heartbeat; null = the base capabilities every runner has. */
  @Column({ type: 'jsonb', nullable: true })
  capabilities?: string[] | null

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date
}
