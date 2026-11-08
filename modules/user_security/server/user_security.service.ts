import 'reflect-metadata';
import type { UserSecurity, SafeUserSecurity, SecurityLock } from './user_security.types';
import {
  getByUserId, getSafeByUserId, createDefaultUserSecurity,
  updateUserSecurity, upsertUserSecurity,
} from './user_security.crud.service';
import {
  recordLoginAttempt, isLocked, pushPasswordHistory,
  getPasswordHistory, getPasswordChangedAt, setMustChangePassword,
} from './user_security.login.service';
import {
  generateBackupCodes, verifyAndConsumeBackupCode,
  hasMfaConfigured, emitMfaChanged,
  trustDevice, isDeviceTrusted, revokeTrustedDevices,
  listTrustedDevices, revokeTrustedDevicesBy, type ListedTrustedDevice, type TrustedDeviceActor,
} from './user_security.mfa.service';
import {
  lockAccount, unlockAccount, getSecurityLock, isSecurityLocked, type LockAccountInput,
} from './user_security.lock.service';

/**
 * User-security service facade. The implementation is split across focused
 * modules (`user_security.crud.service`, `.login.service`, `.mfa.service`, plus
 * the `user_security.helpers`); this class preserves the single
 * `UserSecurityService.*` entry point its callers depend on.
 */
export default class UserSecurityService {
  static getByUserId(userId: string): Promise<UserSecurity> {
    return getByUserId(userId);
  }

  static getSafeByUserId(userId: string): Promise<SafeUserSecurity> {
    return getSafeByUserId(userId);
  }

  static createDefaultUserSecurity(userId: string): Promise<UserSecurity> {
    return createDefaultUserSecurity(userId);
  }

  static updateUserSecurity(userId: string, data: Partial<UserSecurity>): Promise<UserSecurity> {
    return updateUserSecurity(userId, data);
  }

  static upsertUserSecurity(userId: string, data: Partial<UserSecurity>): Promise<UserSecurity> {
    return upsertUserSecurity(userId, data);
  }

  static recordLoginAttempt(
    userId: string,
    success: boolean,
    ip?: string,
    device?: string,
    options?: { maxAttempts?: number; lockDurationMinutes?: number; tenantId?: string },
  ): Promise<void> {
    return recordLoginAttempt(userId, success, ip, device, options);
  }

  /** The GUESSING lock (failed passwords): it refuses the password sign-in only. The security lock is `getSecurityLock`. */
  static isLocked(userId: string): Promise<boolean> {
    return isLocked(userId);
  }

  /**
   * Phase 55 00.1: the SECURITY lock, set by an administrator or the firewall. Refuses every sign-in method (checked in
   * user_session createSession) and ends the live sessions. See user_security.lock.service.ts.
   */
  static lockAccount(userId: string, input: LockAccountInput): Promise<{ lock: SecurityLock; sessionsEnded: boolean }> {
    return lockAccount(userId, input);
  }

  static unlockAccount(userId: string, input: { actorId: string | null; reason?: string | null; source?: 'admin' | 'firewall'; notify?: boolean }): Promise<{ wasLocked: boolean }> {
    return unlockAccount(userId, input);
  }

  static getSecurityLock(userId: string): Promise<SecurityLock | null> {
    return getSecurityLock(userId);
  }

  static isSecurityLocked(userId: string): Promise<boolean> {
    return isSecurityLocked(userId);
  }

  static pushPasswordHistory(userId: string, passwordHash: string, historyCount: number): Promise<void> {
    return pushPasswordHistory(userId, passwordHash, historyCount);
  }

  static getPasswordHistory(userId: string): Promise<string[]> {
    return getPasswordHistory(userId);
  }

  static getPasswordChangedAt(userId: string): Promise<Date | null> {
    return getPasswordChangedAt(userId);
  }

  static setMustChangePassword(userId: string, value: boolean): Promise<void> {
    return setMustChangePassword(userId, value);
  }

  static generateBackupCodes(userId: string, count = 10): Promise<string[]> {
    return generateBackupCodes(userId, count);
  }

  static verifyAndConsumeBackupCode(userId: string, code: string): Promise<boolean> {
    return verifyAndConsumeBackupCode(userId, code);
  }

  static hasMfaConfigured(userId: string): Promise<boolean> {
    return hasMfaConfigured(userId);
  }

  static emitMfaChanged(tenantId: string, userId: string, enabled: boolean, detail?: { method?: string | null; by?: 'user' | 'admin' }): Promise<void> {
    return emitMfaChanged(tenantId, userId, enabled, detail);
  }

  static trustDevice(userId: string, label: string | null, ttlDays = 30): Promise<string> {
    return trustDevice(userId, label, ttlDays);
  }

  static isDeviceTrusted(userId: string, token: string | null | undefined): Promise<boolean> {
    return isDeviceTrusted(userId, token);
  }

  static revokeTrustedDevices(userId: string): Promise<void> {
    return revokeTrustedDevices(userId);
  }

  /** Phase 55 00.6: the person's trusted devices as they are shown (no token hash), newest first. */
  static listTrustedDevices(userId: string): Promise<ListedTrustedDevice[]> {
    return listTrustedDevices(userId);
  }

  /** Phase 55 00.6: revoke one trusted device (`deviceId`) or all of them, audited with who acted. */
  static revokeTrustedDevicesBy(userId: string, actor: TrustedDeviceActor, deviceId?: string | null): Promise<{ count: number }> {
    return revokeTrustedDevicesBy(userId, actor, deviceId);
  }
}
