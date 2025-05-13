import bcrypt from "bcrypt";
import redis from "../../shared/libs/redis";
import prisma from "../../shared/libs/prisma";
import { OTPMethod } from "@prisma/client";
import { authenticator } from "otplib";
import AuthMessages from "../dictionaries";
import MailService from "../../mail/services";
import SMSService from "../../sms/services";
import {SafeUser} from "../../user/types/SafeUser";
import {SafeUserSession} from "../../auth/types/SafeUserSession";

export default class UserSessionOTPService {
  static readonly OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS || "600");
  static readonly OTP_LENGTH = parseInt(process.env.OTP_LENGTH || "6");
  static readonly OTP_RATE_LIMIT_SECONDS = parseInt(process.env.OTP_RATE_LIMIT_SECONDS || "60");
  static readonly OTP_RATE_LIMIT_MAX_ATTEMPTS = 5;

  // -- Helpers --

  private static otpKey(sessionId: string, method: OTPMethod): string {
    return `otp:code:${sessionId}:${method}`;
  }

  private static rateKey(sessionId: string, method: OTPMethod): string {
    return `otp:rate:${sessionId}:${method}`;
  }

  static generateToken(length = this.OTP_LENGTH): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min)).toString().padStart(length, "0");
  }

  static async hashToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  static async compareToken(raw: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(raw, hashed);
  }

  static async generateTOTPSecret(): Promise<string> {
    return authenticator.generateSecret();
  }

  static async getUserOTPSecret(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { userId },
      select: { otpSecret: true },
    });
    if (!user) throw new Error(AuthMessages.USER_NOT_FOUND);
    return user.otpSecret;
  }

  // -- Core Logic --

  private static async incrementRateLimit(sessionId: string, method: OTPMethod): Promise<void> {
    const key = this.rateKey(sessionId, method);
    const current = await redis.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= this.OTP_RATE_LIMIT_MAX_ATTEMPTS) {
      throw new Error(AuthMessages.RATE_LIMIT_EXCEEDED);
    }

    await redis.set(key, (count + 1).toString(), "EX", this.OTP_RATE_LIMIT_SECONDS);
  }

  private static async storeOTP(sessionId: string, method: OTPMethod, token: string): Promise<void> {
    const hashed = await this.hashToken(token);
    await redis.set(this.otpKey(sessionId, method), hashed, "EX", this.OTP_EXPIRY_SECONDS);
  }

  private static async validateOTPCode(sessionId: string, method: OTPMethod, otpToken: string): Promise<void> {
    const hashed = await redis.get(this.otpKey(sessionId, method));
    if (!hashed) throw new Error(AuthMessages.OTP_EXPIRED);

    const isValid = await this.compareToken(otpToken, hashed);
    if (!isValid) throw new Error(AuthMessages.INVALID_OTP);

    await redis.del(this.otpKey(sessionId, method));
    await redis.del(this.rateKey(sessionId, method));
  }

  static async sendOTP({
    user,
    userSession,
    method,
  }: {
    user: SafeUser;
    userSession: SafeUserSession;
    method: OTPMethod;
  }) {
    if (!userSession.otpVerifyNeeded) throw new Error(AuthMessages.OTP_NOT_NEEDED);
    if (userSession.sessionExpiry < new Date()) throw new Error(AuthMessages.SESSION_NOT_FOUND);
    if (method === OTPMethod.TOTP_APP) throw new Error(AuthMessages.INVALID_OTP_METHOD);

    const sessionId = userSession.userSessionId;

    await this.incrementRateLimit(sessionId, method);
    await redis.del(this.otpKey(sessionId, method));

    const token = this.generateToken();
    await this.storeOTP(sessionId, method, token);

    switch (method) {
      case OTPMethod.EMAIL:
        if (!user.email) throw new Error(AuthMessages.USER_HAS_NO_EMAIL);
        await MailService.sendOTPEmail({
          email: user.email,
          name: user.name,
          otpToken: token,
        });
        break;

      case OTPMethod.SMS:
        if (!user.phone) throw new Error(AuthMessages.USER_HAS_NO_PHONE_NUMBER);
        await SMSService.sendShortMessage({
          to: user.phone,
          body: `Your OTP code is ${token}. Valid for ${this.OTP_EXPIRY_SECONDS / 60} minutes.`,
        });
        break;

      default:
        throw new Error(AuthMessages.INVALID_OTP_METHOD);
    }
  }

  static async validateOTP({
    user,
    userSession,
    otpToken,
    method,
  }: {
    user: SafeUser;
    userSession: SafeUserSession;
    otpToken: string;
    method: OTPMethod;
  }) {
    if (!userSession.otpVerifyNeeded) throw new Error(AuthMessages.OTP_NOT_NEEDED);
    if (userSession.sessionExpiry < new Date()) throw new Error(AuthMessages.SESSION_NOT_FOUND);

    const sessionId = userSession.userSessionId;

    if (method === OTPMethod.TOTP_APP) {
      const secret = await this.getUserOTPSecret(user.userId);
      if (!secret || !authenticator.check(otpToken, secret)) {
        throw new Error(AuthMessages.INVALID_OTP);
      }
    } else {
      await this.validateOTPCode(sessionId, method, otpToken);
    }

    await prisma.userSession.update({
      where: { userSessionId: sessionId },
      data: { otpVerifyNeeded: false },
    });
  }
}
