import 'reflect-metadata';
import crypto from 'crypto';

import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';

import { UserSecurity as UserSecurityEntity } from './entities/UserSecurity';
import { UserSecurity, SafeUserSecurity, UserSecuritySchema, SafeUserSecuritySchema } from './user_security.types';
import { OTPMethod } from './user_security.enums';
import { UserSecurityMessages } from './user_security.messages';

const LOCK_DURATION_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;

export default class UserSecurityService {

  // ──────────────────────────────────────────────────────────────────────────
  // Find or Create
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns existing security record or creates a default one.
   */
  static async findOrCreate(userId: string): Promise<UserSecurity> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const existing = await repo.findOne({ where: { userId } });
    if (existing) return UserSecuritySchema.parse(existing);

    const security = repo.create({
      userId,
      failedLoginAttempts: 0,
      otpMethods: [],
    });
    const saved = await repo.save(security);
    return UserSecuritySchema.parse(saved);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Failed Login Attempts
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Increments the failed login counter. Locks the account at MAX_FAILED_ATTEMPTS.
   */
  static async recordFailedAttempt(userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const security = await repo.findOne({ where: { userId } });
    if (!security) {
      throw new AppError(UserSecurityMessages.ACCOUNT_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    const attempts = security.failedLoginAttempts + 1;
    await repo.update({ userId }, { failedLoginAttempts: attempts });

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await this.lockAccount(userId, LOCK_DURATION_MINUTES);
    }
  }

  /**
   * Resets the failed login counter (call after a successful login).
   */
  static async clearFailedAttempts(userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    await repo.update({ userId }, { failedLoginAttempts: 0, lockedUntil: undefined });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Account Locking
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Sets lockedUntil to now + durationMinutes.
   */
  static async lockAccount(userId: string, durationMinutes: number = LOCK_DURATION_MINUTES): Promise<void> {
    const lockedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    await repo.update({ userId }, { lockedUntil });
  }

  /**
   * Returns true if the account is currently locked.
   */
  static async isAccountLocked(userId: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const security = await repo.findOne({ where: { userId } });
    if (!security || !security.lockedUntil) return false;
    return new Date() < security.lockedUntil;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OTP Methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns the list of active OTP methods for the user.
   */
  static async getOTPMethods(userId: string): Promise<OTPMethod[]> {
    const security = await this.findOrCreate(userId);
    return (security.otpMethods ?? []) as OTPMethod[];
  }

  /**
   * Adds an OTP method if not already present.
   */
  static async addOTPMethod(userId: string, method: OTPMethod): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const security = await repo.findOne({ where: { userId } });
    if (!security) {
      throw new AppError(UserSecurityMessages.ACCOUNT_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    const methods = security.otpMethods ?? [];
    if (methods.includes(method)) {
      throw new AppError(UserSecurityMessages.OTP_METHOD_ALREADY_ENABLED, 409, ErrorCode.CONFLICT);
    }

    await repo.update({ userId }, { otpMethods: [...methods, method] });
  }

  /**
   * Removes an OTP method. Throws if the method is not enabled.
   */
  static async removeOTPMethod(userId: string, method: OTPMethod): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const security = await repo.findOne({ where: { userId } });
    if (!security) {
      throw new AppError(UserSecurityMessages.ACCOUNT_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    const methods = security.otpMethods ?? [];
    if (!methods.includes(method)) {
      throw new AppError(UserSecurityMessages.OTP_METHOD_NOT_ENABLED, 400, ErrorCode.VALIDATION_ERROR);
    }

    await repo.update({ userId }, { otpMethods: methods.filter((m) => m !== method) });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TOTP Secret
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Stores the TOTP secret for the user.
   */
  static async setOTPSecret(userId: string, secret: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    await repo.update({ userId }, { otpSecret: secret });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Backup Codes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Hashes and stores backup codes for the user.
   */
  static async setOTPBackupCodes(userId: string, codes: string[]): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const hashed = codes.map((code) =>
      crypto.createHash('sha256').update(code).digest('hex')
    );
    await repo.update({ userId }, { otpBackupCodes: hashed });
  }

  /**
   * Verifies a backup code against the stored hashes. Removes the used code on success.
   */
  static async verifyOTPBackupCode(userId: string, code: string): Promise<boolean> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    const security = await repo.findOne({ where: { userId } });
    if (!security || !security.otpBackupCodes) return false;

    const hashed = crypto.createHash('sha256').update(code).digest('hex');
    const index = security.otpBackupCodes.indexOf(hashed);
    if (index === -1) return false;

    // Remove the used backup code
    const remaining = [...security.otpBackupCodes];
    remaining.splice(index, 1);
    await repo.update({ userId }, { otpBackupCodes: remaining });
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Email Verification
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Marks the user's email as verified.
   */
  static async setEmailVerified(userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    await repo.update({ userId }, { emailVerifiedAt: new Date() });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Last Login
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Records the last login timestamp and IP address.
   */
  static async updateLastLogin(userId: string, ip: string): Promise<void> {
    const repo = AppDataSource.getRepository(UserSecurityEntity);
    await repo.update({ userId }, { lastLoginAt: new Date(), lastLoginIp: ip });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Safe fields
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Strips sensitive fields (otpSecret, otpBackupCodes) from a security record.
   */
  static omitSensitiveFields(security: UserSecurity): SafeUserSecurity {
    return SafeUserSecuritySchema.parse(security);
  }
}
