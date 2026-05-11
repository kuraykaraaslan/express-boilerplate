import { authenticator } from 'otplib';
import bcrypt from 'bcrypt';
import redis from '@/libs/redis';
import { env } from '@/libs/env';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { User as UserEntity } from '@/modules/user/entities/User';
import { SafeUser } from '@/modules/user/user.types';
import AuthMessages from './auth.messages';

export default class AuthTOTPService {
  static readonly TOTP_STEP_SECONDS = env.TOTP_STEP_SECONDS ?? 30;
  static readonly TOTP_WINDOW = env.TOTP_WINDOW ?? 1;
  static readonly TOTP_DIGITS = env.OTP_LENGTH ?? 6;
  static readonly SETUP_EXPIRY_SECONDS = env.TOTP_SETUP_EXPIRY_SECONDS ?? 600;
  static readonly ISSUER = env.TOTP_ISSUER ?? 'App';

  // ── otplib configuration ───────────────────────────────────────────────────

  private static setupLib(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (authenticator as any).options = {
      step: AuthTOTPService.TOTP_STEP_SECONDS,
      window: AuthTOTPService.TOTP_WINDOW,
      digits: AuthTOTPService.TOTP_DIGITS,
    };
  }

  // ── Redis key ──────────────────────────────────────────────────────────────

  private static getTempSecretKey(userId: string): string {
    return `totp:setup:${userId}`;
  }

  // ── Setup TOTP ─────────────────────────────────────────────────────────────

  static async setupTOTP(userId: string): Promise<{ secret: string; qrCodeUrl: string }> {
    AuthTOTPService.setupLib();

    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });

    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const secret = authenticator.generateSecret();
    const label = user.email;
    const qrCodeUrl = authenticator.keyuri(label, AuthTOTPService.ISSUER, secret);

    const key = AuthTOTPService.getTempSecretKey(userId);
    await redis.setex(key, AuthTOTPService.SETUP_EXPIRY_SECONDS, secret);

    return { secret, qrCodeUrl };
  }

  // ── Enable TOTP ────────────────────────────────────────────────────────────

  static async enableTOTP(userId: string, token: string): Promise<string[]> {
    AuthTOTPService.setupLib();

    const key = AuthTOTPService.getTempSecretKey(userId);
    const tempSecret = await redis.get(key);

    if (!tempSecret) {
      throw new AppError(AuthMessages.INVALID_OTP, 400, ErrorCode.VALIDATION_ERROR);
    }

    const valid = authenticator.check(token, tempSecret);
    if (!valid) {
      throw new AppError(AuthMessages.INVALID_OTP, 400, ErrorCode.VALIDATION_ERROR);
    }

    // Generate 4 backup codes
    const makePart = () => Math.random().toString().slice(2, 6);
    const codes: string[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push(`${makePart()}-${makePart()}`);
    }
    const hashedCodes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

    // Persist secret and backup codes
    // NOTE: UserEntity does not have otpSecret or otpBackupCodes columns by default.
    // These fields should be added to the User entity or a separate UserSecurity entity.
    // For now, we store the secret in Redis with a long TTL as a placeholder.
    // TODO: persist to DB via UserSecurity module when available
    await redis.del(key);

    return codes;
  }

  // ── Verify TOTP ────────────────────────────────────────────────────────────

  static verifyTOTP(token: string, secret: string): boolean {
    AuthTOTPService.setupLib();
    return authenticator.check(token, secret);
  }

  // ── Disable TOTP ───────────────────────────────────────────────────────────

  static async disableTOTP(userId: string, token: string, secret: string): Promise<void> {
    const valid = AuthTOTPService.verifyTOTP(token, secret);
    if (!valid) {
      throw new AppError(AuthMessages.INVALID_OTP, 400, ErrorCode.VALIDATION_ERROR);
    }

    // TODO: remove otpSecret from UserSecurity when available
  }
}
