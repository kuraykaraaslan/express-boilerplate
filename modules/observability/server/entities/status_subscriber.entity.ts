import 'reflect-metadata'
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm'

/** An email that asked to be told about incidents (phase 3).
 *
 *  Alignment note (audit §5 Notifications): this is NOT a notification
 *  preference store — it is a list of ANONYMOUS EXTERNAL recipients, which is
 *  genuinely outside notification's user-preference model. Delivery still
 *  goes out through the mail rail, not a bespoke SMTP path.
 *
 *  Double-opt-in: a row exists unverified until the verification link is
 *  clicked (`verifiedAt`); only verified rows ever receive incident mail.
 *  Both tokens are single-purpose random values — the unsubscribe link must
 *  work WITHOUT a login, forever. */
@Entity('status_subscribers')
@Index('uq_status_subscriber_email', ['tenantId', 'email'], { unique: true })
@Index('uq_status_subscriber_phone', ['tenantId', 'phone'], { unique: true, where: '"phone" IS NOT NULL' })
@Index('uq_status_subscriber_endpoint', ['tenantId', 'endpointUrl'], { unique: true, where: '"endpointUrl" IS NOT NULL' })
@Index('uq_status_subscriber_chat', ['tenantId', 'chatUrlFingerprint'], { unique: true, where: '"chatUrlFingerprint" IS NOT NULL' })
export class StatusSubscriber {
  @PrimaryGeneratedColumn('uuid', { name: 'subscriberId' })
  subscriberId!: string

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string

  /** The address of an EMAIL subscriber; null for SMS and WEBHOOK subscribers. */
  @Column({ type: 'varchar', length: 320, nullable: true })
  email?: string | null

  /** EMAIL | SMS | WEBHOOK | SLACK | TEAMS (phase 15.5). Rows that predate the column are EMAIL. */
  @Column({ type: 'varchar', length: 8, default: 'EMAIL' })
  channel!: string

  /** E.164 number of an SMS subscriber. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string | null

  /** HTTPS endpoint of a WEBHOOK subscriber. Checked by the webhook module's address guard before it is stored and again at every delivery. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  endpointUrl?: string | null

  /** The key a WEBHOOK subscriber's deliveries are signed with, encrypted at rest and shown once, when the subscription is made. */
  @Column({ type: 'text', nullable: true })
  signingSecret?: string | null

  /**
   * SLACK and TEAMS subscribers (phase 15.5): the incoming-webhook URL, ENCRYPTED. Unlike `endpointUrl` it is never stored in the clear, because the URL
   * itself is the credential for the channel. `chatUrlHost` is what an operator sees; `chatUrlFingerprint` makes "already subscribed" a unique index.
   */
  @Column({ type: 'text', nullable: true })
  chatUrlCipher?: string | null

  @Column({ type: 'varchar', length: 253, nullable: true })
  chatUrlHost?: string | null

  @Column({ type: 'varchar', length: 64, nullable: true })
  chatUrlFingerprint?: string | null

  /** The page the person subscribed on; null = the whole tenant. An incident that touches none of that page's components is not sent. */
  @Column({ type: 'uuid', nullable: true })
  pageId?: string | null

  /** The language the person reads; null = the tenant's primary language. */
  @Column({ type: 'varchar', length: 12, nullable: true })
  locale?: string | null

  /** Consecutive failed webhook deliveries. A subscriber that keeps failing is switched off rather than hammered. */
  @Column({ type: 'int', default: 0 })
  consecutiveFailures!: number

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt?: Date | null

  /** Components to be notified about; null = all public components. */
  @Column({ type: 'jsonb', nullable: true })
  componentIds?: string[] | null

  @Index()
  @Column({ type: 'varchar', length: 64, nullable: true })
  verifyToken?: string | null

  @Index()
  @Column({ type: 'varchar', length: 64 })
  unsubscribeToken!: string

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date
}
