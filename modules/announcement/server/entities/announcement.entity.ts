import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/** One language's text of an announcement. `body` is Markdown (sanitised when shown: no raw HTML). */
export interface AnnouncementText {
  title: string;
  body: string;
}

/** Who gets it. Every list empty or null = no narrowing on that axis. */
export interface AnnouncementAudience {
  /** null = every active tenant (platform announcements only); a tenant's own announcement names its tenant. */
  tenantIds: string[] | null;
  /** Member roles (OWNER, ADMIN, USER); empty = everyone. */
  roles: string[];
  /** Plan ids (the `plan` facet); empty = any plan. */
  plans: string[];
  /** Editions (the `edition` facet); empty = any. */
  editions: string[];
}

/** The numbers of a sent announcement: people reached, and deliveries per channel. */
export interface AnnouncementStats {
  recipients?: number;
  delivered?: Record<string, number>;
  failed?: Record<string, number>;
  /** Mail was left out because the day's mail cap of this kind was reached. */
  mailCapped?: boolean;
  /** Times the tick queued the fan-out again without it getting further (D23); see `FANOUT_MAX_RESTARTS`. */
  restarts?: number;
  /** The fan-out's cursor at the last restart: a cursor that moved since means progress, and the count starts again. */
  restartCursor?: string | null;
  /** Why the fan-out gave up (status FAILED): the reason shown to the sender, when, after how many restarts. */
  failure?: { reason: string; at: string; restarts: number };
}

/**
 * A message from the platform operator (tenantId null) or a tenant admin (their tenant) to people, on the channels it names
 * (docs/phases/47-announcements). Lives on the SYSTEM connection like `maintenance_windows`: a platform row has no tenant
 * and reaches every tenant, so every read and write is a deliberate `withSystemRLS` block that filters on the sender's
 * tenant itself (announcement.service).
 */
@Entity('announcements')
@Index('IDX_announcements_tenant_status', ['tenantId', 'status'])
@Index('IDX_announcements_due', ['status', 'sendAt'])
// A maintenance window has one notice per stage.
@Index('UQ_announcements_window_stage', ['windowId', 'stage'], { unique: true, where: '"windowId" IS NOT NULL' })
export class Announcement {
  @PrimaryGeneratedColumn('uuid', { name: 'announcementId', primaryKeyConstraintName: 'PK_announcements' })
  announcementId!: string;

  /** null = the platform operator's, to tenants across the platform. */
  @Column({ type: 'uuid', nullable: true })
  tenantId!: string | null;

  /** GENERAL | MAINTENANCE (announcement.enums.ts). */
  @Column({ type: 'varchar', length: 20, default: 'GENERAL' })
  kind!: string;

  /** DRAFT | SCHEDULED | SENDING | SENT | EXPIRED | WITHDRAWN | FAILED. */
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status!: string;

  /** info | warning | critical. */
  @Column({ type: 'varchar', length: 10, default: 'info' })
  severity!: string;

  /** Text per language: `{ en: { title, body }, tr: { … } }`; a missing language falls back to `defaultLanguage`. */
  @Column({ type: 'jsonb' })
  content!: Record<string, AnnouncementText>;

  @Column({ type: 'varchar', length: 16, default: 'en' })
  defaultLanguage!: string;

  /** Where to read more: an app path (`/status`) or an https URL. */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  linkUrl!: string | null;

  @Column({ type: 'jsonb' })
  audience!: AnnouncementAudience;

  /** popup | toast | banner | inapp | mail | push | sms. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  channels!: string[];

  /** When to send; null = by hand (a draft) or on its window's event (a SCHEDULED maintenance notice). */
  @Column({ type: 'timestamp', nullable: true })
  sendAt!: Date | null;

  /** After this the popup and the banner stop and the bell entry lapses. */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  withdrawnAt!: Date | null;

  /** The maintenance window a MAINTENANCE notice belongs to. */
  @Column({ type: 'uuid', nullable: true })
  windowId!: string | null;

  /** scheduled | reminder | start | end: which notice of the window. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  stage!: string | null;

  /** A person changed a notice the window made, so a later change of the window no longer rewrites it. */
  @Column({ type: 'boolean', default: false })
  edited!: boolean;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  stats!: AnnouncementStats;

  /** The fan-out's resume point: the last user id it reached (a retried job goes on from here). */
  @Column({ type: 'uuid', nullable: true })
  fanoutCursor!: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
