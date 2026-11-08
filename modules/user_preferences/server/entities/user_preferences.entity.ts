import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { DEFAULT_LANGUAGE } from '@kuraykaraaslan-labs/common';

@Entity('user_preferences')
export class UserPreferences {
  @PrimaryGeneratedColumn('uuid', { name: 'userPreferencesId' })
  userPreferencesId!: string;

  @Column({ unique: true, type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', default: 'SYSTEM' })
  theme!: string;

  @Column({ type: 'varchar', default: DEFAULT_LANGUAGE })
  language!: string;
  // ^ CANONICAL user language (audit 2026-08, DUP-07). `users.locale` was a
  // second writable "user language" that nothing read; it was dropped in
  // migration 024, and this is the only per-person answer left. The `app_locale`
  // cookie is a fast SSR MIRROR of this value, not a rival: the switcher writes
  // both together, and the RSC layout reads the cookie because it must resolve a
  // locale before it can query anything. Resolution order is documented on the
  // User entity.

  @Column({ type: 'boolean', default: true })
  emailNotifications!: boolean;

  @Column({ type: 'boolean', default: false })
  smsNotifications!: boolean;

  @Column({ type: 'boolean', default: true })
  pushNotifications!: boolean;

  /** Toggles for notification channels without a dedicated column; `{}` = all allowed. */
  @Column({ type: 'jsonb', default: '{}' })
  channelPrefs!: Record<string, boolean>;

  // Marketing consents default OFF (06-user 1.3; migration 001). Existing rows keep their stored value.
  @Column({ type: 'boolean', default: false })
  newsletter!: boolean;

  @Column({ type: 'varchar', default: 'USD' })
  currency!: string;

  @Column({ type: 'varchar', default: 'DOT_COMMA' })
  numberFormat!: string;

  @Column({ type: 'varchar', default: 'METRIC' })
  measurementSystem!: string;

  @Column({ type: 'varchar', default: 'UTC' })
  timezone!: string;

  @Column({ type: 'varchar', default: 'DD_MM_YYYY' })
  dateFormat!: string;

  @Column({ type: 'varchar', default: 'H24' })
  timeFormat!: string;

  @Column({ type: 'varchar', default: 'MON' })
  firstDayOfWeek!: string;

  @Column({ type: 'boolean', default: false })
  productUpdates!: boolean;

  @Column({ type: 'boolean', default: false })
  promotionalOffers!: boolean;

  /** General announcements by mail, push and SMS (docs/phases/47-announcements, D16): opt-out, on by default. Migration 002. */
  @Column({ type: 'boolean', default: true })
  announcements!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  newsletterConsentAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  marketingConsentAt!: Date | null;

  @Column({ type: 'int', default: 1 })
  schemaVersion!: number;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
