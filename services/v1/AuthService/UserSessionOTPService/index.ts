// OTPService.ts
import prisma from "../../../../libs/prisma";
import AuthMessages from "../../../../dictionaries/AuthMessages";
import MailService from "../../NotificationService/MailService";
import SMSService from "../../NotificationService/SMSService";
import bcrypt from "bcrypt";
import VerifyOTPRequest from "../../../../dtos/requests/auth/VerifyOTPRequest";
import SendOTPRequest from "../../../../dtos/requests/auth/SendOTPRequest";
import ChangeOTPStatusRequest from "../../../../dtos/requests/auth/ChangeOTPStatusRequest";
import ChangeOTPVerifyRequest from "../../../../dtos/requests/auth/ChangeOTPVerifyRequest";
import UserOmit from "../../../../types/UserOmit";
import MessageResponse from "../../../../dtos/responses/MessageResponse";
import { OTPMethod, User, UserSession } from "@prisma/client";
import UserSessionOTPMailService from "./UserSessionOTPMailService";
import UserSessionOTPSMSService from "./UserSessionOTPSMSService";
import UserSessionOTPTOTPService from "./UserSessionOTPTOTPService";
import redisInstance from "../../../../libs/redis";


export default class UserSessionOTPService {

  static OTP_EXPIRY_MS = parseInt(process.env.OTP_EXPIRY_MS || "600000"); // 10 dakika
  static OTP_RATE_LIMIT_SECONDS = parseInt(process.env.OTP_RATE_LIMIT_SECONDS || "60"); // 1 dk
  static OTP_LENGTH = parseInt(process.env.OTP_LENGTH || "6");



  static validateSession(userSession: UserSession): void {
    if (!userSession.otpNeeded) throw new Error(AuthMessages.OTP_NOT_NEEDED);
    if (userSession.otpVerified) throw new Error(AuthMessages.OTP_VERIFIED_SUCCESSFULLY);
    if (userSession.sessionExpiry < new Date()) throw new Error(AuthMessages.SESSION_NOT_FOUND);
  }

  static generateToken(length = UserSessionOTPService.OTP_LENGTH): string {
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

  static async sendOTP({ user, userSession, method }: { user: User; userSession: UserSession; method: OTPMethod }) {
    this.validateSession(userSession);
    await this.rateLimitGuard(userSession.userSessionId, method); // ✅ Rate limit kontrolü

    switch (method) {
      case OTPMethod.EMAIL:
        await UserSessionOTPMailService.sendOTP({ user, userSession });
        break;
      case OTPMethod.SMS:
        await UserSessionOTPSMSService.sendOTP({ user, userSession });
        break;
      default:
        throw new Error(AuthMessages.INVALID_OTP_METHOD);
    }
  }

  static async validateOTP({ user, userSession, otpToken, method }: { user: User; userSession: UserSession; otpToken: string; method: OTPMethod }) {
    this.validateSession(userSession);

    switch (method) {
      case OTPMethod.EMAIL:
        await UserSessionOTPMailService.validateOTP({ userSession, otpToken });
        break;
      case OTPMethod.SMS:
        await UserSessionOTPSMSService.validateOTP({ userSession, otpToken });
        break;
      case OTPMethod.TOTP_APP:
        await UserSessionOTPTOTPService.validateOTP({ user, userSession, otpToken });
        break;
      default:
        throw new Error(AuthMessages.INVALID_OTP_METHOD);
    }

    await this.markAsVerified(userSession.userSessionId); // ✅ Doğrulama sonrası işaretleme
  }

  static async markAsVerified(userSessionId: string): Promise<void> {
    await prisma.userSession.update({
      where: { userSessionId },
      data: { otpVerified: true },
    });

    // Delete the OTP record from the database
    await prisma.userSessionOTP.deleteMany({
      where: {
        userSessionId,
      },
    });

    const key = `otp:rate:${userSessionId}`;
    await redisInstance.del(key);
    
  }

  static async rateLimitGuard(userSessionId: string, method: OTPMethod): Promise<void> {
    const key = `otp:rate:${userSessionId}:${method}`;
    const exists = await redisInstance.get(key);
    if (exists) {
      throw new Error(AuthMessages.OTP_ALREADY_SENT);
    }
    await redisInstance.set(key, "1", "EX", UserSessionOTPService.OTP_RATE_LIMIT_SECONDS);
  }
}
