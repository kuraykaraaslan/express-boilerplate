import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import Logger from '@kuraykaraaslan-labs/logger';
import { getUserSecurityPolicy } from './user_security.settings-policy';
import { UserSecurity as UserSecurityEntity } from './entities/user_security.entity';
import { type TrustedDevice } from './user_security.types';
import UserSecurityMessages from './user_security.messages';
import { sha256, safeEqualHex, clearCache } from './user_security.helpers';
import { updateUserSecurity, getSafeByUserId } from './user_security.crud.service';

// ── Backup codes — stored as SHA-256 hashes, shown in plaintext only once ──

/** Generate `count` single-use backup codes, persist their hashes, return the plaintext (once). */
export async function generateBackupCodes(userId: string, count = 10): Promise<string[]> {
  const plain = Array.from({ length: count }, () => randomBytes(5).toString('hex')); // 10 hex chars
  const hashes = plain.map(sha256);
  await updateUserSecurity(userId, { otpBackupCodes: hashes });
  return plain;
}

/** Verify a backup code in constant time; on success consume (remove) it. */
export async function verifyAndConsumeBackupCode(userId: string, code: string): Promise<boolean> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSecurityEntity);
  const security = await repo.findOne({ where: { userId } });
  if (!security) return false;
  const stored = Array.isArray(security.otpBackupCodes) ? (security.otpBackupCodes as string[]) : [];
  const target = sha256(code.trim());
  const idx = stored.findIndex((h) => safeEqualHex(h, target));
  if (idx === -1) return false;
  stored.splice(idx, 1);
  await repo.update({ userId }, { otpBackupCodes: stored as any });
  await clearCache(userId);
  // Phase 55 00.4: a recovery code standing in for the second factor is a signal of its own (lost device, or stolen codes).
  auditSecurityEvent(null, userId, AuditActions.AUTH_RECOVERY_CODE_USED, { codesLeft: stored.length });
  return true;
}

// ── Per-tenant MFA enforcement policy ──
// MS-37 (2026-10-27): `getMfaPolicy` / `isMfaRequiredFor` (`mfaRequired`, `mfaRequiredRoles`) were removed. Nothing called
// them, and the requirement they described is already enforced by two policies: tenant_session's `twoFactorRequired`
// (every member of the tenant must present a session that proved a second factor, tenant_session.policy.ts
// assert2faSatisfied; owner-only, guarded on Settings → Sign-in policy) and auth's `adminRequireMfa` (the admin panel,
// on by default). A third, unenforced pair would have been a second policy for one thing.

/** True when the user has at least one active second factor configured. */
export async function hasMfaConfigured(userId: string): Promise<boolean> {
  const sec = await getSafeByUserId(userId);
  return (sec.otpMethods?.length ?? 0) > 0 || sec.passkeyEnabled === true;
}

/**
 * A second factor was added to or removed from the account: one audit row and one tenant webhook (best-effort, never throws).
 *
 * Phase 55 00.4: this had no caller, so neither `security.mfa_enabled` nor `security.mfa_disabled` was ever written or sent. It is
 * now called where a factor actually changes (auth's otp/verify enable and disable, totp/enable, totp/disable, and an administrator's
 * 2FA reset, `by: 'admin'`). The row's
 * severity comes from the action (audit_log.enums): adding a factor is `medium`, removing one is `high` (the first move in taking
 * an account over is turning its second factor off). `method` names the factor; `methodsLeft` / `mfaLeft` say what the account
 * still has afterwards, read here so every caller reports the same thing. The audit action and the webhook event share their name.
 * The auth-only `auth.totp_enabled` / `auth.totp_disabled` actions were removed rather than written beside these: one fact, one row.
 */
export async function emitMfaChanged(
  tenantId: string,
  userId: string,
  enabled: boolean,
  detail: { method?: string | null; by?: 'user' | 'admin' } = {},
): Promise<void> {
  const action = enabled ? AuditActions.SECURITY_MFA_ENABLED : AuditActions.SECURITY_MFA_DISABLED;
  const sec = await Promise.resolve().then(() => getSafeByUserId(userId)).catch(() => null);
  const methodsLeft = Array.isArray(sec?.otpMethods) ? [...(sec!.otpMethods as string[])] : null;
  const facts = {
    ...(detail.method ? { method: detail.method } : {}),
    // Who removed or added it: the person (the default, not written) or an administrator's reset (user.support.service resetTwoFactor).
    ...(detail.by === 'admin' ? { by: 'admin' } : {}),
    ...(methodsLeft ? { methodsLeft, mfaLeft: methodsLeft.length > 0 || sec?.passkeyEnabled === true } : {}),
  };
  auditSecurityEvent(tenantId, userId, action, { enabled, ...facts });
  await WebhookService.dispatchEvent(tenantId, action, {
    userId, at: new Date().toISOString(), ...facts,
  }).catch((err: unknown) => Logger.warn(`[user_security] mfa webhook failed: ${err instanceof Error ? err.message : err}`));
}

// ── Trusted devices (remember-this-device) — only token hashes are stored ──

/**
 * Register a trusted device and return the opaque token to set as a secure,
 * httpOnly cookie. Only the SHA-256 hash of the token is persisted.
 */
export async function trustDevice(userId: string, label: string | null, ttlDays = 30): Promise<string> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSecurityEntity);
  const security = await repo.findOne({ where: { userId } });
  if (!security) throw new AppError(UserSecurityMessages.SECURITY_RECORD_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  // The installation's lifetime (`trustedDeviceTtlDays`, ROOT, 1..30) can only shorten the caller's.
  const { trustedDeviceTtlDays } = await getUserSecurityPolicy();
  const days = Math.min(ttlDays, trustedDeviceTtlDays);
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  const existing = (Array.isArray(security.trustedDevices) ? security.trustedDevices : []) as TrustedDevice[];
  const pruned = existing.filter((d) => new Date(d.expiresAt) > now);
  pruned.push({ idHash: sha256(token), label, createdAt: now.toISOString(), lastSeenAt: now.toISOString(), expiresAt: expires.toISOString() });
  await repo.update({ userId }, { trustedDevices: pruned as any });
  await clearCache(userId);
  auditSecurityEvent(null, userId, 'security.trusted_device_added', { label: label ?? null, expiresAt: expires.toISOString() });
  return token;
}

/** True when the presented device token matches a non-expired trusted device. */
export async function isDeviceTrusted(userId: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const ds = await getDataSource();
  const security = await ds.getRepository(UserSecurityEntity).findOne({ where: { userId } });
  if (!security) return false;
  const target = sha256(token);
  const now = new Date();
  const devices = (Array.isArray(security.trustedDevices) ? security.trustedDevices : []) as TrustedDevice[];
  const match = devices.find((d) => new Date(d.expiresAt) > now && safeEqualHex(d.idHash, target));
  if (!match) return false;
  // A lifetime shortened after the device was trusted ends it too: `createdAt + trustedDeviceTtlDays`. A record without a
  // readable `createdAt` keeps its own `expiresAt` (every record this service writes has one).
  const created = new Date(match.createdAt).getTime();
  if (!Number.isFinite(created)) return true;
  const { trustedDeviceTtlDays } = await getUserSecurityPolicy();
  return created + trustedDeviceTtlDays * 86_400_000 > now.getTime();
}

/** Revoke all trusted devices for a user (e.g. on password change or logout-everywhere). */
export async function revokeTrustedDevices(userId: string): Promise<void> {
  const ds = await getDataSource();
  await ds.getRepository(UserSecurityEntity).update({ userId }, { trustedDevices: [] as any });
  await clearCache(userId);
  auditSecurityEvent(null, userId, 'security.trusted_device_removed', {});
}

// ── Phase 55 00.6: list and revoke one person's trusted devices (the account page and the platform user page) ──

/**
 * A trusted device as it is shown: never its token hash. `deviceId` is derived from the hash (a hash of it, cut to 32 hex), so
 * it names the device to revoke without handing out the value the device cookie is compared against.
 */
export interface ListedTrustedDevice {
  deviceId: string;
  label: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  /** When it stops skipping the sign-in code: its own end, or earlier when the installation's lifetime was shortened since. */
  expiresAt: string;
}

const deviceIdOf = (idHash: string) => sha256(`trusted-device:${idHash}`).slice(0, 32);

/** The effective end of a trusted device (see `isDeviceTrusted`): its own `expiresAt`, cut by `createdAt + trustedDeviceTtlDays`. */
function effectiveEnd(d: TrustedDevice, ttlDays: number): number {
  const own = new Date(d.expiresAt).getTime();
  const created = new Date(d.createdAt).getTime();
  return Number.isFinite(created) ? Math.min(own, created + ttlDays * 86_400_000) : own;
}

/** The person's trusted devices that still skip the sign-in code, newest first. */
export async function listTrustedDevices(userId: string): Promise<ListedTrustedDevice[]> {
  const ds = await getDataSource();
  const security = await ds.getRepository(UserSecurityEntity).findOne({ where: { userId } });
  if (!security) return [];
  const { trustedDeviceTtlDays } = await getUserSecurityPolicy();
  const now = Date.now();
  const devices = (Array.isArray(security.trustedDevices) ? security.trustedDevices : []) as TrustedDevice[];
  return devices
    .map((d) => ({ d, end: effectiveEnd(d, trustedDeviceTtlDays) }))
    .filter(({ end }) => Number.isFinite(end) && end > now)
    .sort((a, b) => String(b.d.createdAt).localeCompare(String(a.d.createdAt)))
    .map(({ d, end }) => ({
      deviceId: deviceIdOf(d.idHash), label: d.label ?? null, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt ?? null, expiresAt: new Date(end).toISOString(),
    }));
}

export interface TrustedDeviceActor {
  /** Who acts: the person (`self`, the account page) or an administrator (`admin`); null actorId = the firewall. */
  by: 'self' | 'admin' | 'firewall';
  actorId: string | null;
  reason?: string | null;
}

/**
 * Revokes one trusted device (`deviceId`) or, without one, all of them. The next sign-in on a revoked device asks for the code
 * again; no session ends (ending sessions is its own action). Audited: `security.trusted_device_removed` when the person acts,
 * `security.trusted_device_revoked_by_admin` (high) otherwise. Answers how many were revoked; a `deviceId` that names nothing is 404.
 */
export async function revokeTrustedDevicesBy(userId: string, actor: TrustedDeviceActor, deviceId?: string | null): Promise<{ count: number }> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSecurityEntity);
  const security = await repo.findOne({ where: { userId } });
  const devices = (Array.isArray(security?.trustedDevices) ? security!.trustedDevices : []) as TrustedDevice[];
  const kept = deviceId ? devices.filter((d) => deviceIdOf(d.idHash) !== deviceId) : [];
  const count = devices.length - kept.length;
  if (deviceId && count === 0) throw new AppError(UserSecurityMessages.TRUSTED_DEVICE_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  if (security && count > 0) {
    await repo.update({ userId }, { trustedDevices: kept as any });
    await clearCache(userId);
  }
  AuditLogService.log({
    tenantId: null,
    actorId: actor.actorId,
    actorType: actor.actorId ? 'USER' : 'SYSTEM',
    action: actor.by === 'self' ? 'security.trusted_device_removed' : 'security.trusted_device_revoked_by_admin',
    resourceType: 'user_security',
    resourceId: userId,
    metadata: { by: actor.by, deviceId: deviceId ?? null, count, reason: actor.reason ?? null },
  }).catch(() => {});
  return { count };
}

/** Best-effort security audit entry — never throws into the caller. */
function auditSecurityEvent(
  tenantId: string | null,
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
  severity?: 'low' | 'medium' | 'high' | 'critical',
): void {
  AuditLogService.log({
    tenantId,
    actorId: userId,
    actorType: 'USER',
    action,
    ...(severity ? { severity } : {}),
    resourceType: 'user_security',
    resourceId: userId,
    metadata,
  }).catch(() => {});
}
