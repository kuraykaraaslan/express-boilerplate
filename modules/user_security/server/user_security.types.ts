import { z } from 'zod';
import { OTPMethodEnum } from './user_security.enums';

export const TrustedDeviceSchema = z.object({
  idHash: z.string(),          // SHA-256 of the device token — never the raw token
  label: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  expiresAt: z.string(),
});
export type TrustedDevice = z.infer<typeof TrustedDeviceSchema>;

export const UserSecuritySchema = z.object({
  otpMethods: z.array(OTPMethodEnum).nullish().transform(val => val ?? []),
  otpSecret: z.string().nullable(),
  otpBackupCodes: z.array(z.string()).nullish().transform(val => val ?? []),
  lastLoginAt: z.date().nullable(),
  lastLoginIp: z.string().nullable(),
  lastLoginDevice: z.string().nullable(),
  failedLoginAttempts: z.number().nullish().transform(val => val ?? 0),
  lockedUntil: z.date().nullable(),
  // Denormalized MFA-posture flag; passkey credentials live in modules/auth_passkey.
  passkeyEnabled: z.boolean().nullish().transform(val => val ?? false),
  trustedDevices: z.array(TrustedDeviceSchema).nullish().transform(val => val ?? []),
  // ── KD-7: rotation history (bcrypt hashes, most recent first) ─────────
  passwordHistory: z.array(z.string()).nullish().transform(val => val ?? []),
  passwordChangedAt: z.date().nullable().optional(),
  // ── KD-4: force-change on first/next login ────────────────────────────
  mustChangePassword: z.boolean().nullish().transform(val => val ?? false),
  // ── Phase 55 00.1: the security lock (user_security.lock.service.ts). Optional so a cached row written before it still parses. ──
  securityLockedAt: z.date().nullable().optional(),
  securityLockedUntil: z.date().nullable().optional(),
  securityLockReason: z.string().nullable().optional(),
  securityLockedBy: z.string().nullable().optional(),
  securityLockSource: z.string().nullable().optional(),
});

/**
 * What a session, the account page and the login routes may see. The security lock is left out: its reason is an operator's or the
 * firewall's note, read through `UserSecurityService.getSecurityLock` by the admin routes only.
 */
export const SafeUserSecuritySchema = UserSecuritySchema.omit({
  otpSecret: true,
  otpBackupCodes: true,
  passwordHistory: true,
  securityLockedAt: true,
  securityLockedUntil: true,
  securityLockReason: true,
  securityLockedBy: true,
  securityLockSource: true,
});

export const SecurityLockSourceEnum = z.enum(['admin', 'firewall']);
export type SecurityLockSource = z.infer<typeof SecurityLockSourceEnum>;

/** An account's security lock while it holds (phase 55 00.1). `until` null = until an unlock. */
export type SecurityLock = {
  lockedAt: Date;
  until: Date | null;
  reason: string;
  actorId: string | null;
  source: SecurityLockSource;
};

export const SafeUserSecurityDefault: z.infer<typeof SafeUserSecuritySchema> = {
  otpMethods: [],
  lastLoginAt: null,
  lastLoginIp: null,
  lastLoginDevice: null,
  failedLoginAttempts: 0,
  lockedUntil: null,
  passkeyEnabled: false,
  trustedDevices: [],
  passwordChangedAt: null,
  mustChangePassword: false,
};

export type UserSecurity = z.infer<typeof UserSecuritySchema>;
export type SafeUserSecurity = z.infer<typeof SafeUserSecuritySchema>;
