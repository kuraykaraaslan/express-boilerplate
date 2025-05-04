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

export default class UserSessionOTPService {


  static readonly OTP_EXPIRY_MS = parseInt(process.env.OTP_EXPIRY_MS || "600000");
  static readonly OTP_LENGTH = parseInt(process.env.OTP_LENGTH || "6");

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

  static async sendOTP({ user, userSession, method }: { user: User; userSession: UserSession; method: OTPMethod }): Promise<void> {

    this.validateSession(userSession);


    switch (method) {
      case OTPMethod.EMAIL:
        await UserSessionOTPMailService.sendOTP({ user, userSession });
        break;
      case OTPMethod.SMS:
        await UserSessionOTPSMSService.sendOTP({ user, userSession });
        break;
      case OTPMethod.TOTP_APP:
        // TOTP is not supported for sending OTP
        throw new Error(AuthMessages.INVALID_OTP_METHOD);
      default:
        throw new Error(AuthMessages.INVALID_OTP_METHOD);
    }

  }

  static async validateOTP({ user, userSession, otpToken, method }: { user: User, userSession: UserSession; otpToken: string; method: OTPMethod }): Promise<void> {

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

  }

}