import nodemailer from "nodemailer";

import FirstVerifyMailTemplate from "./MailTemplates/FirstVerifyMailTemplate";
import PasswordResetMailTemplate from "./MailTemplates/PasswordResetMailTemplate";
import OTPMailTemplate from "./MailTemplates/OTPMailTemplate";
import EmailChangeMailTemplate from "./MailTemplates/EmailChangeMailTemplate";
import EmailChangedNotificationMailTemplate from "./MailTemplates/EmailChangedNotificationMailTemplate";
import InviteUserTemplate from "./MailTemplates/InviteUserTemplate";

import Logger from "./Logger";

export default class SendMail {
  private static transporter = nodemailer.createTransport({
    host: process.env.NODEMAILER_HOST,
    port: Number(process.env.NODEMAILER_PORT),
    secure: false,
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });

  static sendEmailChangeEmail: any;

  static async sendFirstVerifyMail(email: string, code: string): Promise<void> {
    try {
      const mailBody = FirstVerifyMailTemplate({ email, code });

      await SendMail.transporter.sendMail({
        from: process.env.NODEMAILER_USER,
        to: email,
        subject: "Verify your email address " + process.env.APP_NAME,
        html: mailBody,
      });

      Logger.info("Email sent to " + email + ": " + code);
    } catch (error: any) {
      Logger.error("Error sending email to " + email + ": " + code, error);
    }
  }

  static async sendPasswordResetMail(
    email: string,
    code: string,
  ): Promise<void> {
    try {
      const mailBody = PasswordResetMailTemplate({ email, code });

      await SendMail.transporter.sendMail({
        from: process.env.NODEMAILER_USER,
        to: email,
        subject: "Reset your password " + process.env.APP_NAME,
        html: mailBody,
      });

      Logger.info("Email sent to " + email + ": " + code);
    } catch (error: any) {
      Logger.error("Error sending email to " + email + ": " + code, error);
    }
  }

  static async sendOTPMail(email: string, code: string): Promise<void> {
    try {
      const mailBody = OTPMailTemplate({ email, code });

      await SendMail.transporter.sendMail({
        from: process.env.NODEMAILER_USER,
        to: email,
        subject: "Your OTP for " + process.env.APP_NAME,
        html: mailBody,
      });

      Logger.info("Email sent to " + email + ": " + code);
    } catch (error: any) {
      Logger.error("Error sending email to " + email + ": " + code, error);
    }
  }

  static async sendEmailChangeMail(email: string, code: string): Promise<void> {
    try {
      const mailBody = EmailChangeMailTemplate({ email, code });

      await SendMail.transporter.sendMail({
        from: process.env.NODEMAILER_USER,
        to: email,
        subject: "Change your email address " + process.env.APP_NAME,
        html: mailBody,
      });

      Logger.info("Email sent to " + email + ": " + code);
    } catch (error: any) {
      Logger.error("Error sending email to " + email + ": " + code, error);
    }
  }

  static async sendEmailChangedNotificationMail(
    targetEmail: string,
    newEmail: string,
  ): Promise<void> {
    try {
      const mailBody = EmailChangedNotificationMailTemplate({
        targetEmail,
        newEmail,
      });

      await SendMail.transporter.sendMail({
        from: process.env.NODEMAILER_USER,
        to: targetEmail,
        subject: "Your email address has been changed " + process.env.APP_NAME,
        html: mailBody,
      });

      Logger.info("Email sent to " + targetEmail + ": " + newEmail);
    } catch (error: any) {
      Logger.error(
        "Error sending email to " + targetEmail + ": " + newEmail,
        error,
      );
    }
  }


  static async sendInviteUserMail(
    tenantName: string,
    email: string,
    code: string,
  ): Promise<void> {
    try {
      const mailBody = InviteUserTemplate({ tenantName, email, code });

      await SendMail.transporter.sendMail({
        from: process.env.NODEMAILER_USER,
        to: email,
        subject: "You have been invited to " + tenantName + " on " + process.env.APP_NAME,
        html: mailBody,
      });

      Logger.info("Email sent to " + email + ": " + code);
    } catch (error: any) {
      Logger.error("Error sending email to " + email + ": " + code, error);
    }
  }
}
