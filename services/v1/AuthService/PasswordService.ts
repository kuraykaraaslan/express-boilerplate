import bcrypt from "bcrypt";
import crypto from "crypto";
import redis from "../../../libs/redis";
import prisma from "../../../libs/prisma";
import AuthMessages from "../../../dictionaries/AuthMessages";
import MailService from "../NotificationService/MailService";
import SMSService from "../NotificationService/SMSService";
import ForgotPasswordRequest from "../../../dtos/requests/auth/ForgotPasswordRequest";
import ResetPasswordRequest from "../../../dtos/requests/auth/ResetPasswordRequest";

export default class PasswordService {
  static RESET_TOKEN_EXPIRY_SECONDS = parseInt(process.env.RESET_TOKEN_EXPIRY_SECONDS || "3600"); // 1 saat
  static RESET_TOKEN_LENGTH = Math.max(4, parseInt(process.env.RESET_TOKEN_LENGTH || "6"));

  static generateResetToken(length = this.RESET_TOKEN_LENGTH): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + Math.random() * (max - min)).toString().padStart(length, "0");
  }

  static async hashToken(token: string): Promise<string> {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  static getRedisKey(email: string, method: "email" | "sms"): string {
    return `reset-password:${method}:${email.toLowerCase()}`;
  }

  static getRateKey(email: string, method: "email" | "sms"): string {
    return `reset-password-rate:${method}:${email.toLowerCase()}`;
  }

  static async forgotPassword(data: ForgotPasswordRequest): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new Error(AuthMessages.USER_NOT_FOUND);

    const emailKey = user.email.toLowerCase();

    const emailToken = this.generateResetToken();
    const hashedEmailToken = await this.hashToken(emailToken);
    const emailTokenKey = this.getRedisKey(emailKey, "email");
    const emailRateKey = this.getRateKey(emailKey, "email");

    const alreadyEmailSent = await redis.get(emailRateKey);
    if (!alreadyEmailSent) {
      await redis.set(emailTokenKey, hashedEmailToken, "EX", this.RESET_TOKEN_EXPIRY_SECONDS);
      await redis.set(emailRateKey, "1", "EX", 60);
      await MailService.sendForgotPasswordEmail(user.email, user.name || undefined, emailToken);
    }

    if (user.phone) {
      const smsToken = this.generateResetToken();
      const hashedSmsToken = await this.hashToken(smsToken);
      const smsTokenKey = this.getRedisKey(emailKey, "sms");
      const smsRateKey = this.getRateKey(emailKey, "sms");

      const alreadySmsSent = await redis.get(smsRateKey);
      if (!alreadySmsSent) {
        await redis.set(smsTokenKey, hashedSmsToken, "EX", this.RESET_TOKEN_EXPIRY_SECONDS);
        await redis.set(smsRateKey, "1", "EX", 60);
        await SMSService.sendShortMessage({
          to: user.phone,
          body: `Your password reset code is ${smsToken}. It will expire in ${this.RESET_TOKEN_EXPIRY_SECONDS / 60} minutes.`,
        });
      }
    }
  }

  static async resetPassword(data: ResetPasswordRequest & { method: "email" | "sms" }): Promise<void> {
    const user = await prisma.user.findFirst({ where: { email: data.email } });
    if (!user) throw new Error(AuthMessages.USER_NOT_FOUND);

    const key = this.getRedisKey(user.email, data.method);
    const storedHashed = await redis.get(key);
    if (!storedHashed) throw new Error(AuthMessages.INVALID_TOKEN);

    const hashedInput = await this.hashToken(data.resetToken);
    if (hashedInput !== storedHashed) {
      throw new Error(AuthMessages.INVALID_TOKEN);
    }

    await prisma.user.update({
      where: { userId: user.userId },
      data: {
        password: await bcrypt.hash(data.password, 10),
      },
    });

    await redis.del(key); // one-time usage

    await MailService.sendPasswordResetSuccessEmail(user.email, user.name || undefined);

    if (user.phone) {
      await SMSService.sendShortMessage({
        to: user.phone,
        body: `Your password has been successfully reset.`,
      });
    }
  }
}
