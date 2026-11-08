import 'reflect-metadata';
import { Entity, PrimaryColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * One person's copy of an announcement: written by the fan-out for every recipient, once per person however many tenants
 * they belong to (the primary key). It is what the shell reads to show a popup or a banner to someone who signs in later,
 * and where the acknowledgement is kept, so a popup acknowledged in one workspace is gone in all of them (D17).
 */
@Entity('announcement_receipts')
@Index('IDX_announcement_receipts_user', ['userId'])
export class AnnouncementReceipt {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_announcement_receipts' })
  announcementId!: string;

  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'PK_announcement_receipts' })
  userId!: string;

  /** The workspace it was delivered in (the bell entry lives there). */
  @Column({ type: 'uuid' })
  tenantId!: string;

  /** The dispatcher channels that delivered it (inapp, mail, push, sms). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  channels!: string[];

  /** When the dispatcher was called for this person; null = not yet (a retried fan-out sends only these). */
  @Column({ type: 'timestamp', nullable: true })
  deliveredAt!: Date | null;

  /** First shown in the shell (popup, banner or toast). */
  @Column({ type: 'timestamp', nullable: true })
  seenAt!: Date | null;

  /** OK pressed on the popup. */
  @Column({ type: 'timestamp', nullable: true })
  acknowledgedAt!: Date | null;

  /** The banner closed. */
  @Column({ type: 'timestamp', nullable: true })
  dismissedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;
}
