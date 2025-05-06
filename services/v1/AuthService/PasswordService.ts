import bcrypt from "bcrypt";
import crypto from "crypto";
import redis from "../../../libs/redis";
import prisma from "../../../libs/prisma";
import AuthMessages from "../../../dictionaries/AuthMessages";
import MailService from "../NotificationService/MailService";
import ForgotPasswordRequest from "../../../dtos/requests/auth/ForgotPasswordRequest";
import ResetPasswordRequest from "../../../dtos/requests/auth/ResetPasswordRequest";
import SafeUser from "../../../types/SafeUser";
import UserSessionService from "./UserSessionService";
import UserService from "../UserService";

export default class PasswordService {
  static readonly RESET_TOKEN_EXPIRY_SECONDS = parseInt(process.env.RESET_TOKEN_EXPIRY_SECONDS || "3600");
  static readonly RESET_TOKEN_LENGTH = Math.max(4, parseInt(process.env.RESET_TOKEN_LENGTH || "6"));
  static readonly MAX_RATE_LIMIT_PER_HOUR = parseInt(process.env.MAX_RATE_LIMIT_PER_HOUR || "5");
  static readonly MAX_RATE_LIMIT_EXPIRY_SECONDS = parseInt(process.env.MAX_RATE_LIMIT_EXPIRY_SECONDS || "3600");

  private static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private static hashSha256(data: string): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private static parseJSONSafe(data?: string | null): any | null {
    if (!data) return null;

    try {
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private static getNumericKey(email: string): string {
    return `reset-password-numeric:${this.hashSha256(email)}`;
  }

  private static get64Key(base64Token: string): string {
    return `reset-password-64:${this.hashSha256(base64Token)}`;
  }

  private static getRateKey(email: string): string {
    return `reset-password-rate:${this.hashSha256(email)}`;
  }

  // -- Token Generation --

  static generateNumericToken(): string {
    const min = Math.pow(10, this.RESET_TOKEN_LENGTH - 1);
    const max = Math.pow(10, this.RESET_TOKEN_LENGTH) - 1;
    return crypto.randomInt(min, max + 1).toString().padStart(this.RESET_TOKEN_LENGTH, "0");
  }

  static encodeBase64(token: string): string {
    return Buffer.from(token, "utf-8").toString("base64url");
  }

  // -- Redis Operations --

  private static async storeTokens(email: string, numericToken: string): Promise<string> {
    const base64Token = this.encodeBase64(numericToken);
    const hashedNumericToken = this.hashSha256(numericToken);
    const emailKey = this.getNumericKey(email);
    const tokenKey = this.get64Key(base64Token);

    await redis.set(emailKey, JSON.stringify({ hashedNumericToken, base64Token, issuedAt: Date.now() }), "EX", this.RESET_TOKEN_EXPIRY_SECONDS);
    await redis.set(tokenKey, JSON.stringify({ email, issuedAt: Date.now() }), "EX", this.RESET_TOKEN_EXPIRY_SECONDS);

    return base64Token;
  }

  private static async invalidateTokens(email: string): Promise<void> {
    const key = this.getNumericKey(email);
    const oldStored = await redis.get(key);
    const parsed = this.parseJSONSafe(oldStored);

    if (parsed?.base64Token) {
      await redis.del(this.get64Key(parsed.base64Token));
    }
    await redis.del(key);
  }

  // -- Rate Limit --

  private static async checkAndIncrementRateLimit(email: string): Promise<void> {
    const rateKey = this.getRateKey(email);
    const rate = await redis.incr(rateKey);
    if (rate === 1) await redis.expire(rateKey, this.MAX_RATE_LIMIT_EXPIRY_SECONDS);
    if (rate > this.MAX_RATE_LIMIT_PER_HOUR) throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED);
  }

  // -- Public APIs --

  static async forgotPassword({ email }: ForgotPasswordRequest): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await UserService.getByEmail(normalizedEmail);
    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND);

    await this.checkAndIncrementRateLimit(normalizedEmail);
    await this.invalidateTokens(normalizedEmail);

    const numericToken = this.generateNumericToken();
    const base64Token = await this.storeTokens(normalizedEmail, numericToken);

    await MailService.sendForgotPasswordEmail({
      email: normalizedEmail,
      name: user.name || undefined,
      numericToken,
      base64Token,
    });
  }

  static async resetPassword(data: ResetPasswordRequest): Promise<void> {
    const usingNumeric = !!data.numericToken;
    const usingBase64 = !!data.base64Token;
    if (usingNumeric && usingBase64) throw new AppError(AuthMessages.HAVE_BOTH_TOKENS_PROVIDED);

    if (usingNumeric) {
      if (!data.email) throw new AppError(AuthMessages.EITHER_EMAIL_OR_PHONE_MUST_BE_PROVIDED);
      const email = this.normalizeEmail(data.email);
      const user = await UserService.getByEmail(email);
      if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND);

      const stored = await redis.get(this.getNumericKey(email));
      const parsed = this.parseJSONSafe(stored);
      if (!parsed) throw new AppError(AuthMessages.INVALID_TOKEN);

      const hashedInput = this.hashSha256(data.numericToken!);
      const isValid = crypto.timingSafeEqual(Buffer.from(parsed.hashedNumericToken), Buffer.from(hashedInput));
      if (!isValid) throw new AppError(AuthMessages.INVALID_TOKEN);

      await this.invalidateTokens(email);
      await this.updatePasswordAndNotify(user, data.password);
    }

    else if (usingBase64) {
      const tokenKey = this.get64Key(data.base64Token!);
      const stored = await redis.get(tokenKey);
      const parsed = this.parseJSONSafe(stored);
      if (!parsed) throw new AppError(AuthMessages.INVALID_TOKEN);

      const user = await UserService.getByEmail(parsed.email);
      if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND);
      await this.invalidateTokens(parsed.email);
      await this.updatePasswordAndNotify(user, data.password);
    }

    else {
      throw new AppError(AuthMessages.INVALID_TOKEN);
    }
  }

  private static async updatePasswordAndNotify(user: SafeUser, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new AppError(AuthMessages.PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS_LONG);

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { userId: user.userId },
      data: { password: hashedPassword },
    });

    await MailService.sendPasswordResetSuccessEmail(user.email, user.name);
    await UserSessionService.deleteAllUserSessions(user.userId);
  }
}
