// PasswordService.ts
import prisma from "../../../libs/prisma";
import bcrypt from "bcrypt";
import crypto from "crypto";
import AuthErrors from "../../../errors/AuthErrors";
import MailService from "../NotificationService/MailService";
import TwilloService from "../NotificationService/TwilloService";
import ForgotPasswordRequest from "../../../dtos/requests/auth/ForgotPasswordRequest";
import ResetPasswordRequest from "../../../dtos/requests/auth/ResetPasswordRequest";

export default class PasswordService {
  static generateResetToken(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  static async hashToken(token: string): Promise<string> {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Sends a password reset email to the user.
   * @param email - The user's email.
   */
  static async forgotPassword(data: ForgotPasswordRequest): Promise<void> {

    // Get the user by email
    let user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new Error(AuthErrors.USER_NOT_FOUND);
    }

    const resetToken = PasswordService.generateResetToken();

    // Save the token to the user
    user = await prisma.user.update({
      where: { userId: user.userId },
      data: {
        resetToken: resetToken,
        resetTokenExpiry: new Date(Date.now() + 3600000), // 1 hour
      },
    });

    // Send the password reset email
    MailService.sendForgotPasswordEmail(user.email, user.name || undefined, resetToken);
    TwilloService.sendSMS(user.phone, `Your password reset token is ${user.resetToken}`);

  }


  /**
   * Resets the password of the user.
   * @param token - The password reset token.
   * @param password - The new password.
   */
  static async resetPassword(data: ResetPasswordRequest): Promise<void> {

    // Get the user by token
    const user = await prisma.user.findFirst({
      where: { email: data.email },
    });

    if (!user) {
      throw new Error(AuthErrors.USER_NOT_FOUND);
    }

    // Check if the token is valid
    if (user.resetToken !== data.resetToken || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
      throw new Error(AuthErrors.INVALID_TOKEN);
    }

    // Update the user's password
    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        password: await bcrypt.hash(data.password, 10),
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    // Notify the user
    MailService.sendPasswordResetSuccessEmail(user.email, user.name || undefined);
    TwilloService.sendSMS(user.phone, "Your password has been reset successfully.");

  }

}