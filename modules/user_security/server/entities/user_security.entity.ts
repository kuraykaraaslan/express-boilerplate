import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_securities')
export class UserSecurity {
  @PrimaryGeneratedColumn('uuid', { name: 'userSecurityId' })
  userSecurityId!: string;

  @Column({ unique: true, type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: ['EMAIL', 'SMS', 'TOTP_APP'], array: true, default: '{}' })
  otpMethods!: string[];

  @Column({ nullable: true, type: 'varchar' })
  otpSecret?: string;

  @Column({ type: 'jsonb', default: '[]' })
  otpBackupCodes!: unknown[];

  @Column({ nullable: true, type: 'timestamp' })
  lastLoginAt?: Date;

  @Column({ nullable: true, type: 'varchar' })
  lastLoginIp?: string;

  @Column({ nullable: true, type: 'varchar' })
  lastLoginDevice?: string;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ nullable: true, type: 'timestamp' })
  lockedUntil?: Date;

  // Denormalized MFA-posture flag. Passkey credentials themselves live in the
  // `passkey_credentials` table owned by modules/auth_passkey, which keeps this
  // flag in sync as credentials are added or removed.
  @Column({ type: 'boolean', default: false })
  passkeyEnabled!: boolean;

  // ── Trusted devices (remember-this-device) — only SHA-256 token hashes ──
  @Column({ type: 'jsonb', default: '[]' })
  trustedDevices!: unknown[];

  // ── KD-7: password rotation history ─────────────────────────────────────
  @Column({ type: 'jsonb', default: '[]' })
  passwordHistory!: unknown[];

  @Column({ nullable: true, type: 'timestamp' })
  passwordChangedAt?: Date;

  // ── KD-4: force password change on next login ──────────────────────────
  @Column({ type: 'boolean', default: false })
  mustChangePassword!: boolean;

  // ── Phase 55 00.1 (P-1): the SECURITY lock, set by an admin or the firewall ──
  // Separate from the guessing lock above (`lockedUntil`, password sign-in only): this one refuses EVERY sign-in method at the one
  // session-creation path (user_session createSession) and ends the live sessions when it is set. `securityLockedUntil` null = until
  // an unlock; a lock whose until has passed no longer holds (the row keeps it as history until the next lock or unlock).
  @Column({ nullable: true, type: 'timestamp' })
  securityLockedAt?: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  securityLockedUntil?: Date | null;

  @Column({ nullable: true, type: 'varchar', length: 500 })
  securityLockReason?: string | null;

  // The user who set it; null for the firewall or another system actor (see securityLockSource).
  @Column({ nullable: true, type: 'uuid' })
  securityLockedBy?: string | null;

  // 'admin' | 'firewall'
  @Column({ nullable: true, type: 'varchar', length: 16 })
  securityLockSource?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt!: Date;
}
