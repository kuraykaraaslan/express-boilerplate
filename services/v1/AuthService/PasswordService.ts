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

  static async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new Error(AuthErrors.USER_NOT_FOUND);

    const resetToken = this.generateResetToken();
    const hashedToken = await this.hashToken(resetToken);

    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        resetToken: hashedToken,
        resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    MailService.sendForgotPasswordEmail(user.email, user.name || undefined, resetToken);
    TwilloService.sendSMS(user.phone, `Your password reset token is ${resetToken}`);
  }

  static async resetPassword(data: ResetPasswordRequest): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new Error(AuthErrors.USER_NOT_FOUND);

    const hashedTokenInput = await this.hashToken(data.resetToken);

    if (!user.resetToken || user.resetToken !== hashedTokenInput || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
      throw new Error(AuthErrors.INVALID_TOKEN);
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        password: hashedPassword,
        resetToken: null,
        resetTokenExpiry: null,
      },
    });

    MailService.sendPasswordResetSuccessEmail(user.email, user.name || undefined);
    TwilloService.sendSMS(user.phone, "Your password has been reset successfully.");
  }
}