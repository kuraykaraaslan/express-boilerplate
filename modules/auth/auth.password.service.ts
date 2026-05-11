import 'reflect-metadata';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import redis from '@/libs/redis';
import { env } from '@/libs/env';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { User as UserEntity } from '@/modules/user/entities/User';
import AuthMessages from './auth.messages';
import UserSessionService from '@/modules/user_session/user_session.service';

export default class AuthPasswordService {
  private static readonly RESET_TOKEN_EXPIRY_SECONDS =
    env.RESET_TOKEN_EXPIRY_SECONDS ?? 3600;

  private static readonly RESET_TOKEN_LENGTH = Math.max(4, env.RESET_TOKEN_LENGTH ?? 6);
  private static readonly RATE_LIMIT_MAX = 5;
  private static readonly RATE_LIMIT_WINDOW_SECONDS = 3600;

  // ── Key helpers ────────────────────────────────────────────────────────────

  private static hashSha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private static getTokenKey(email: string): string {
    return `reset-password:${AuthPasswordService.hashSha256(email.toLowerCase())}`;
  }

  private static getRateKey(email: string): string {
    return `reset-password-rate:${AuthPasswordService.hashSha256(email.toLowerCase())}`;
  }

  // ── Token generation ───────────────────────────────────────────────────────

  static generateResetToken(length = AuthPasswordService.RESET_TOKEN_LENGTH): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min)).toString().padStart(length, '0');
  }

  // ── Forgot password ────────────────────────────────────────────────────────

  static async forgotPassword({ email }: { email: string }): Promise<void> {
    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { email: email.toLowerCase() } });

    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const rateKey = AuthPasswordService.getRateKey(email);
    const rateRaw = await redis.get(rateKey);
    const rateCount = rateRaw ? parseInt(rateRaw) : 0;

    if (rateCount >= AuthPasswordService.RATE_LIMIT_MAX) {
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    if (rateRaw) {
      await redis.incr(rateKey);
    } else {
      await redis.setex(rateKey, AuthPasswordService.RATE_LIMIT_WINDOW_SECONDS, '1');
    }

    const resetToken = AuthPasswordService.generateResetToken();
    const hashedToken = AuthPasswordService.hashSha256(resetToken);
    const tokenKey = AuthPasswordService.getTokenKey(email);

    await redis.setex(tokenKey, AuthPasswordService.RESET_TOKEN_EXPIRY_SECONDS, hashedToken);

    // TODO: send email with resetToken
    // await MailService.sendForgotPasswordEmail({ email: user.email, resetToken });
  }

  // ── Reset password ─────────────────────────────────────────────────────────

  static async resetPassword({
    email,
    token,
    password,
  }: {
    email: string;
    token: string;
    password: string;
  }): Promise<void> {
    if (password.length < 8) {
      throw new AppError(
        AuthMessages.PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS_LONG,
        400,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const tokenKey = AuthPasswordService.getTokenKey(email);
    const storedHash = await redis.get(tokenKey);

    if (!storedHash) {
      throw new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    }

    const inputHash = AuthPasswordService.hashSha256(token);
    const isValid = crypto.timingSafeEqual(
      Buffer.from(storedHash),
      Buffer.from(inputHash),
    );

    if (!isValid) {
      throw new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    }

    const repo = AppDataSource.getRepository(UserEntity);
    const user = await repo.findOne({ where: { email: email.toLowerCase() } });

    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const hashedPassword = await bcrypt.hash(password, 10);
    await repo.update({ userId: user.userId }, { password: hashedPassword });

    await redis.del(tokenKey);
    await redis.del(AuthPasswordService.getRateKey(email));

    // Invalidate all sessions after password reset
    await UserSessionService.deleteAllUserSessions(user.userId);

    // TODO: send confirmation email
    // await MailService.sendPasswordResetSuccessEmail(user.email, user.name);
  }
}
