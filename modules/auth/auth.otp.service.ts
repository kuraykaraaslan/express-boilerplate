import crypto from 'crypto';
import redis from '@/libs/redis';
import { env } from '@/libs/env';
import { AppError, ErrorCode } from '@/libs/app-error';
import { OTPMethod } from '@/modules/user/user.enums';
import AuthMessages from './auth.messages';

export default class AuthOTPService {
  private static readonly OTP_LENGTH = env.OTP_LENGTH ?? 6;
  private static readonly OTP_EXPIRY_SECONDS = env.OTP_EXPIRY_SECONDS ?? 600;
  private static readonly OTP_RATE_LIMIT_SECONDS = env.OTP_RATE_LIMIT_SECONDS ?? 60;
  private static readonly OTP_MAX_ATTEMPTS = env.OTP_MAX_ATTEMPTS ?? 5;

  // ── Key helpers ────────────────────────────────────────────────────────────

  private static getOTPKey(userId: string, method: OTPMethod): string {
    return `otp:auth:${userId}:${method}`;
  }

  private static getRateKey(userId: string, method: OTPMethod): string {
    return `otp:auth:rate:${userId}:${method}`;
  }

  private static getAttemptKey(userId: string, method: OTPMethod): string {
    return `otp:auth:attempts:${userId}:${method}`;
  }

  // ── OTP generation ─────────────────────────────────────────────────────────

  static generateToken(length = AuthOTPService.OTP_LENGTH): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min))
      .toString()
      .padStart(length, '0');
  }

  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ── Send OTP ───────────────────────────────────────────────────────────────

  static async sendOTP(userId: string, method: OTPMethod): Promise<void> {
    if (method === 'TOTP_APP' || method === 'PUSH_APP') {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    const rateKey = AuthOTPService.getRateKey(userId, method);
    const rateCount = await redis.get(rateKey);

    if (rateCount && parseInt(rateCount) >= AuthOTPService.OTP_MAX_ATTEMPTS) {
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    const otpToken = AuthOTPService.generateToken();
    const hashedToken = AuthOTPService.hashToken(otpToken);

    const otpKey = AuthOTPService.getOTPKey(userId, method);
    await redis.setex(otpKey, AuthOTPService.OTP_EXPIRY_SECONDS, hashedToken);

    if (rateCount) {
      await redis.incr(rateKey);
    } else {
      await redis.setex(rateKey, AuthOTPService.OTP_RATE_LIMIT_SECONDS, '1');
    }

    // TODO: send via email or SMS
    // switch (method) {
    //   case 'EMAIL':
    //     await MailService.sendOTPEmail({ email: user.email, otpToken });
    //     break;
    //   case 'SMS':
    //     await SMSService.sendShortMessage({ to: user.phone, body: `Your OTP is ${otpToken}` });
    //     break;
    // }
  }

  // ── Verify OTP ─────────────────────────────────────────────────────────────

  static async verifyOTP(userId: string, otp: string, method: OTPMethod): Promise<boolean> {
    if (method === 'TOTP_APP' || method === 'PUSH_APP') {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    const otpKey = AuthOTPService.getOTPKey(userId, method);
    const attemptKey = AuthOTPService.getAttemptKey(userId, method);

    const attempts = await redis.get(attemptKey);
    if (attempts && parseInt(attempts) >= AuthOTPService.OTP_MAX_ATTEMPTS) {
      await redis.del(otpKey);
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    const storedHash = await redis.get(otpKey);
    if (!storedHash) {
      throw new AppError(AuthMessages.OTP_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);
    }

    const inputHash = AuthOTPService.hashToken(otp);

    if (inputHash !== storedHash) {
      if (attempts) {
        await redis.incr(attemptKey);
      } else {
        await redis.setex(attemptKey, AuthOTPService.OTP_EXPIRY_SECONDS, '1');
      }
      throw new AppError(AuthMessages.INVALID_OTP, 400, ErrorCode.VALIDATION_ERROR);
    }

    // Clean up on success
    await redis.del(otpKey);
    await redis.del(attemptKey);
    await redis.del(AuthOTPService.getRateKey(userId, method));

    return true;
  }

  // ── Clear OTP ──────────────────────────────────────────────────────────────

  static async clearOTP(userId: string, method: OTPMethod): Promise<void> {
    await redis.del(AuthOTPService.getOTPKey(userId, method));
    await redis.del(AuthOTPService.getAttemptKey(userId, method));
    await redis.del(AuthOTPService.getRateKey(userId, method));
  }
}
