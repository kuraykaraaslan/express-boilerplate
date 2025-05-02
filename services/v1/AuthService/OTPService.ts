// OTPService.ts
import prisma from "../../../libs/prisma";
import AuthMessages from "../../../dictionaries/AuthMessages";
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


  static readonly OTP_EXPIRY_MS = 10 * 60 * 1000;
  static readonly OTP_LENGTH = 6;

  static generateToken(length = OTPService.OTP_LENGTH): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min)).toString();
  }

  static async hashToken(token: string): Promise<string> {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
     * Sends an OTP to the user.
     * @param accessToken - The session token.
     * @param phone - The user's phone number.
     * @param method - The method to send the OTP (sms or email).
     */
  static async otpSend(data: SendOTPRequest): Promise<void> {

    // Get the session by token
    const session = await prisma.userSession.findUnique({
      where: { accessToken: data.accessToken },
    });

    if (!session) {
      throw new AppError(AuthMessages.SESSION_NOT_FOUND, 401);
    }

    //if the session already has no otp needed
    if (!session.otpNeeded) {
      throw new AppError(AuthMessages.OTP_NOT_NEEDED, 400);
    }

    // Generate an OTP
    const otpToken = OTPService.generateToken();
    const hashedOtp = await OTPService.hashToken(otpToken);
    
    // Save the OTP to the session
    await prisma.userSession.update({
      where: { sessionId: session.sessionId },
      data: {
        otpToken : hashedOtp,
        otpTokenExpiry: new Date(Date.now() + OTPService.OTP_EXPIRY_MS),
      },
      include: { user: true },
    });

    const user = await prisma.user.findUnique({
      where: { userId: session.userId },
    });

    if (!user) {
      throw new AppError(AuthMessages.USER_NOT_FOUND, 404);
    }

    switch (data.method) {
      case "sms":
        if (user.phone) {
          TwilloService.sendSMS(user.phone, `Your OTP is ${otpToken}`);
        } else {
          throw new AppError(AuthMessages.USER_HAS_NO_PHONE_NUMBER, 400);
        }
        break;
      case "email":
        if (user.email) {
          MailService.sendMail(user.email, "OTP", `Your OTP is ${otpToken}`);
        } else {
          throw new AppError(AuthMessages.USER_HAS_NO_EMAIL, 400);
        }
        break;
      default:
        throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400);
    }

    return;
  }

  /**
   * Verifies the OTP of the user.
   * @param accessToken - The session token.
   * @param otp - The OTP.
   */
  static async otpVerify(data: VerifyOTPRequest): Promise<void> {

    // Get the session by token
    const session = await prisma.userSession.findUnique({
      where: { accessToken: data.accessToken },
    });

    if (!session) {
      throw new AppError(AuthMessages.SESSION_NOT_FOUND, 401);
    }

    // Check if the OTP is expired
    if (session.otpTokenExpiry && new Date() > session.otpTokenExpiry) {
      throw new AppError(AuthMessages.OTP_EXPIRED, 400);
    }

    
    // Check if the OTP is valid
    const hashedOtp = await OTPService.hashToken(data.otpToken);


    // Check if the OTP is correct
    if (session.otpToken !== hashedOtp) {
      throw new AppError(AuthMessages.INVALID_OTP, 400);
    }

    // Update the session
    await prisma.userSession.update({
      where: { sessionId: session.sessionId },
      data: {
        otpNeeded: false,
        otpToken: null,
        otpTokenExpiry: null,
      },
    });

    return;
  }


  /**
   * Changes the OTP status of the user.
   * @param user - The user object.
   * @param otpEnabled - Whether OTP is enabled.
   */
  static async otpChangeStatus(user: UserOmit, data: ChangeOTPStatusRequest): Promise<void> {
    // If OTP is already enabled then throw an error
    if (data.otpEnabled && user.otpEnabled === data.otpEnabled) {
      throw new AppError(AuthMessages.OTP_ALREADY_ENABLED, 400);
    } else if (!data.otpEnabled && user.otpEnabled === data.otpEnabled) {
      throw new AppError(AuthMessages.OTP_ALREADY_DISABLED, 400);
    }

    const token = OTPService.generateToken();
    const hashedOtp = await OTPService.hashToken(token);

    // Update the user
    const updatedUser = await prisma.user.update({
      where: { userId: user.userId },
      data: {
        otpStatusChangeToken: hashedOtp,
        otpStatusChangeTokenExpiry: new Date(Date.now() + 600000), // 10 minutes
      },
    });

    // Send the OTP
    TwilloService.sendSMS(user.phone, `Your OTP is ${token}`);
    MailService.sendOTPEmail(user.email, user.name, token);
    
    return;
  }

  /**
   * Verifies the OTP status change of the user.
   * @param user - The user object.
   * @param otpEnabled - Whether OTP is enabled.
   * @param otpStatusChangeToken - The OTP status change token.
   */
  static async otpChangeVerify(user: UserOmit, data: ChangeOTPVerifyRequest): Promise<void> {

    // Check if the token is valid
    const updatedUser = await prisma.user.findUnique({
      where: { userId: user.userId },
    });


    if (!updatedUser) {
      throw new AppError(AuthMessages.USER_NOT_FOUND, 404);
    }
    
    if (!updatedUser.otpStatusChangeTokenExpiry || new Date() > updatedUser.otpStatusChangeTokenExpiry) {
      throw new AppError(AuthMessages.INVALID_OTP, 400);
    }

    const hashedOtp = await OTPService.hashToken(data.otpStatusChangeToken);

    if (!updatedUser || updatedUser.otpStatusChangeToken !== hashedOtp) {
      throw new AppError(AuthMessages.INVALID_OTP, 400);
    }

    // if OTP is already enabled then throw an error
    if (data.otpEnabled && user.otpEnabled === data.otpEnabled) {
      // clear the token for security
      await prisma.user.update({
        where: { userId: user.userId },
        data: {
          otpStatusChangeToken: null,
          otpStatusChangeTokenExpiry: null,
        },
      });
      throw new AppError(AuthMessages.OTP_ALREADY_ENABLED, 400);

    }

    if (!data.otpEnabled && user.otpEnabled === data.otpEnabled) {
      // clear the token for security
      await prisma.user.update({
        where: { userId: user.userId },
        data: {
          otpStatusChangeToken: null,
          otpStatusChangeTokenExpiry: null,
        },
      });
      throw new AppError(AuthMessages.OTP_ALREADY_DISABLED, 400);
    }

    // Update the user
    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        otpEnabled: data.otpEnabled,
        otpStatusChangeToken: null,
        otpStatusChangeTokenExpiry: null,
      },
    });


    if (data.otpEnabled) {
      // Send the OTP
      MailService.sendOTPEnabledEmail(user.email, user.name || undefined);
    } else {
      // Send the OTP
      MailService.sendOTPDisabledEmail(user.email, user.name || undefined);
    }

    return;
  }


}