import 'reflect-metadata'
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm'

/**
 * A Slack or Microsoft Teams channel that incident lifecycle events are posted to (observability phase 14.7).
 *
 * The incoming-webhook URL is the credential (neither vendor verifies a signature), so it is kept ONLY as AES-256-GCM ciphertext
 * (`urlCipher`, the platform's field encryption), together with its host for display and a per-tenant fingerprint that makes
 * "this channel is already connected" a unique index without keeping the URL in the clear. No API returns the URL after it was written.
 *
 * `audience` is the flag that decides what the destination may ever see: `INTERNAL` (the default: the responders' own channel) receives every
 * incident of the tenant, private ones included; `PUBLIC` (a customer-facing or shared channel) receives only what the public status page itself
 * says about an incident that IS public, and never a private incident, a reason, or a workflow step.
 */
@Entity('chat_destinations')
@Index('uq_chat_destination_url', ['tenantId', 'urlFingerprint'], { unique: true })
export class ChatDestination {
  @PrimaryGeneratedColumn('uuid', { name: 'destinationId' })
  destinationId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** `SLACK` | `TEAMS`. */
  @Column({ type: 'varchar', length: 8 })
  kind!: string

  @Column({ type: 'varchar', length: 120 })
  label!: string

  /** The webhook URL, encrypted. Never selected into an API view. */
  @Column({ type: 'text' })
  urlCipher!: string

  /** The URL's host, for the screen ("hooks.slack.com"). The path is the secret and is not kept anywhere else. */
  @Column({ type: 'varchar', length: 253 })
  urlHost!: string

  @Column({ type: 'varchar', length: 64 })
  urlFingerprint!: string

  /** `INTERNAL` | `PUBLIC`. */
  @Column({ type: 'varchar', length: 8, default: 'INTERNAL' })
  audience!: string

  /** Event names this destination wants (`incident.created` ...); null = every event its audience may receive. */
  @Column({ type: 'jsonb', nullable: true })
  events?: string[] | null

  /** Severities this destination wants (`MINOR` | `MAJOR` | `CRITICAL`); null = all. */
  @Column({ type: 'jsonb', nullable: true })
  severities?: string[] | null

  @Column({ type: 'boolean', default: true })
  enabled!: boolean

  /** Consecutive failed posts. Ten in a row switch the destination off (a revoked webhook is not hammered). */
  @Column({ type: 'int', default: 0 })
  consecutiveFailures!: number

  /** The outcome code of the last post (`sent`, `http_404`, `timeout` ...): a closed vocabulary, never a response body. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  lastStatus?: string | null

  @Column({ type: 'timestamptz', nullable: true })
  lastSentAt?: Date | null

  @Column({ type: 'timestamptz', nullable: true })
  disabledAt?: Date | null

  @Column({ type: 'uuid', nullable: true })
  createdBy?: string | null

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
