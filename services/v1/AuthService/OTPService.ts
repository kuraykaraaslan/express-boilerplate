// OTPService.ts
import prisma from "../../../libs/prisma";
import AuthErrors from "../../../errors/AuthErrors";
import MailService from "../NotificationService/MailService";
import TwilloService from "../NotificationService/TwilloService";
import crypto from "crypto";
import VerifyOTPRequest from "../../../dtos/requests/auth/VerifyOTPRequest";
import SendOTPRequest from "../../../dtos/requests/auth/SendOTPRequest";
import ChangeOTPStatusRequest from "../../../dtos/requests/auth/ChangeOTPStatusRequest";
import ChangeOTPVerifyRequest from "../../../dtos/requests/auth/ChangeOTPVerifyRequest";
import UserOmit from "../../../types/UserOmit";
import MessageResponse from "../../../dtos/responses/MessageResponse";

export default class OTPService {
  static generateToken(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  static async hashToken(token: string): Promise<string> {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  static async sendOTP(data: SendOTPRequest): Promise<MessageResponse> {
    const hashedAccessToken = await this.hashToken(data.accessToken);
    const session = await prisma.userSession.findUnique({ where: { accessToken: hashedAccessToken } });

    if (!session) throw new Error(AuthErrors.SESSION_NOT_FOUND);
    if (!session.otpNeeded) throw new Error("OTP_NOT_NEEDED");

    const otpToken = this.generateToken();
    const hashedOtp = await this.hashToken(otpToken);

    await prisma.userSession.update({
      where: { sessionId: session.sessionId },
      data: {
        otpToken: hashedOtp,
        otpTokenExpiry: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const user = await prisma.user.findUnique({ where: { userId: session.userId } });
    if (!user) throw new Error(AuthErrors.USER_NOT_FOUND);

    if (data.method === "sms") {
      if (!user.phone) throw new Error(AuthErrors.USER_HAS_NO_PHONE_NUMBER);
      TwilloService.sendSMS(user.phone, `Your OTP is ${otpToken}`);
    } else if (data.method === "email") {
      if (!user.email) throw new Error(AuthErrors.USER_HAS_NO_EMAIL);
      MailService.sendMail(user.email, "OTP", `Your OTP is ${otpToken}`);
    } else {
      throw new Error("INVALID_METHOD");
    }

    return { message: AuthErrors.OTP_SENT_SUCCESSFULLY };
  }

  static async verifyOTP(data: VerifyOTPRequest): Promise<MessageResponse> {
    const hashedAccessToken = await this.hashToken(data.accessToken);
    const session = await prisma.userSession.findUnique({ where: { accessToken: hashedAccessToken } });

    if (!session) throw new Error(AuthErrors.SESSION_NOT_FOUND);
    if (session.otpTokenExpiry && new Date() > session.otpTokenExpiry) throw new Error(AuthErrors.OTP_EXPIRED);

    const hashedOtpInput = await this.hashToken(data.otpToken);
    if (session.otpToken !== hashedOtpInput) throw new Error(AuthErrors.INVALID_OTP);

    await prisma.userSession.update({
      where: { sessionId: session.sessionId },
      data: { otpNeeded: false, otpToken: null, otpTokenExpiry: null },
    });

    return { message: AuthErrors.OTP_VERIFIED_SUCCESSFULLY };
  }

  static async changeStatus(user: UserOmit, data: ChangeOTPStatusRequest): Promise<MessageResponse> {
    if (user.otpEnabled === data.otpEnabled) {
      throw new Error(data.otpEnabled ? AuthErrors.OTP_ALREADY_ENABLED : AuthErrors.OTP_ALREADY_DISABLED);
    }

    const otpStatusToken = this.generateToken();
    const hashed = await this.hashToken(otpStatusToken);

    const updated = await prisma.user.update({
      where: { userId: user.userId },
      data: {
        otpStatusChangeToken: hashed,
        otpStatusChangeTokenExpiry: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    TwilloService.sendSMS(updated.phone, `Your OTP is ${otpStatusToken}`);
    MailService.sendOTPEmail(updated.email, updated.name, otpStatusToken);

    return { message: AuthErrors.OTP_CHANGED_SUCCESSFULLY };
  }

  static async verifyStatusChange(user: UserOmit, data: ChangeOTPVerifyRequest): Promise<MessageResponse> {
    const userInDb = await prisma.user.findUnique({ where: { userId: user.userId } });
    if (!userInDb || !userInDb.otpStatusChangeTokenExpiry || new Date() > userInDb.otpStatusChangeTokenExpiry) {
      throw new Error(AuthErrors.INVALID_OTP);
    }

    const hashedInput = await this.hashToken(data.otpStatusChangeToken);
    if (userInDb.otpStatusChangeToken !== hashedInput) throw new Error(AuthErrors.INVALID_OTP);

    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        otpEnabled: data.otpEnabled,
        otpStatusChangeToken: null,
        otpStatusChangeTokenExpiry: null,
      },
    });

    if (data.otpEnabled) {
      MailService.sendOTPEnabledEmail(user.email, user.name || "User");
    } else {
      MailService.sendOTPDisabledEmail(user.email, user.name || "User");
    }

    return { message: AuthErrors.OTP_CHANGED_SUCCESSFULLY };
  }
}