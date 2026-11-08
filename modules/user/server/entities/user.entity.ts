import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index, Check } from 'typeorm';

/**
 * A person on this deployment. On a fleet node whose people log in through Fleet ID the row is a SHADOW user (FID-07, 12-fleet-identity.md
 * section 4.2): it carries the pairwise subject the hub issued for this node (`identitySub`, F14) and no password. Migration
 * `user:001_users_identity_shadow.sql` creates the same columns, index and CHECKs (same names).
 */
@Entity('users')
@Index('uq_users_identity_sub', ['identitySub'], { unique: true, where: '"identitySub" IS NOT NULL' })
@Check('ck_users_identity_sub', `"identitySub" IS NULL OR "identitySub" ~ '^[A-Za-z0-9_-]{16,128}$'`)
@Check('ck_users_credential_or_identity', `"password" IS NOT NULL OR "identitySub" IS NOT NULL`)
export class User {
  @PrimaryGeneratedColumn('uuid', { name: 'userId' })
  userId!: string;

  @Index()
  @Column({ unique: true, type: 'varchar' })
  email!: string;

  @Index()
  @Column({ nullable: true, type: 'varchar' })
  phone?: string;

  /** bcrypt hash of a local account; NULL for a shadow user, which must then carry `identitySub` (`ck_users_credential_or_identity`). */
  @Column({ type: 'varchar', nullable: true })
  password!: string | null;

  /** Fleet ID pairwise subject for this node (F14); NULL for a local account. Unique among the rows that have one. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  identitySub!: string | null;

  /** Whether `email` is the person's real address released by Fleet ID (F10), as opposed to a synthetic `.invalid` placeholder. */
  @Column({ type: 'boolean', default: false })
  emailReleased!: boolean;

  @Column({ type: 'varchar', default: 'ACTIVE' })
  userStatus!: string;

  @Column({ type: 'varchar', default: 'USER' })
  userRole!: string;

  @Column({ nullable: true, type: 'timestamp' })
  emailVerifiedAt?: Date;

  // GDPR / KVKK / LGPD consent captured at registration (Art. 7 GDPR, Art. 8 LGPD).
  @Column({ nullable: true, type: 'varchar' })
  consentVersion?: string;

  @Column({ nullable: true, type: 'timestamp' })
  consentAcceptedAt?: Date;

  /**
   * There is NO language column here, deliberately (audit 2026-08, DUP-07).
   *
   * `locale` used to live beside `country`, described as "for tax, regulatory
   * and communication workflows". Nothing read it and nothing wrote it — it was
   * not even in `UserSchema`, so it never crossed the wire — while the language
   * the product actually uses is `user_preferences.language`. Two writable
   * "user language" fields with one of them inert is worse than one, because the
   * next person to need a language picks whichever they find first.
   *
   * The resolution order, in one place so both modules can point at it:
   *
   *   1. `app_locale` cookie — this browser, right now. A fast SSR mirror, not
   *      a source of truth; the switcher writes it AND the preference together.
   *   2. `user_preferences.language` — the durable per-person answer. CANONICAL.
   *   3. the tenant's default language, narrowed to its enabled set.
   *
   * A regulatory locale (which tax text, which mandatory disclosure) is a
   * different question from a UI language and would deserve its own explicitly
   * named column when something finally asks it. `country` below is the field
   * that survived from that comment.
   */

  /**
   * ISO-3166-1 alpha-2. Currently written by nothing in-tree; kept because a
   * user's country is a jurisdiction fact, not a preference, and there is no
   * rival field for it — unlike `locale`, which had one.
   */
  @Column({ nullable: true, type: 'varchar', length: 2 })
  country?: string;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
