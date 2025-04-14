import Logger from './../../../libs/logger';
import nodemailer from 'nodemailer';
import ejs from 'ejs';
import path from 'path';
import { User, UserSession } from '@prisma/client';

// Types
import UserOmit from './../../../types/UserOmit';

const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env;

const pwd = process.env.PWD || process.cwd();

export default class MailService {

    static readonly TEMPLATE_PATH = path.join(pwd, 'views', 'email');
    static readonly APPLICATION_NAME = process.env.APPLICATION_NAME || "Express Boilerplate";

    // These are the default values, you can change them in the .env file
    static readonly FRONTEND_URL = process.env.FRONTEND_HOST + ":" + process.env.FRONTEND_PORT;

    static readonly FRONTEND_LOGIN_PATH = process.env.FRONTEND_LOGIN_PATH || "/auth/login";
    static readonly FRONTEND_REGISTER_PATH = process.env.FRONTEND_REGISTER_PATH || "/auth/register";
    static readonly FRONTEND_PRIVACY_PATH = process.env.FRONTEND_PRIVACY_PATH || "/privacy";
    static readonly FRONTEND_TERMS_PATH = process.env.FRONTEND_TERMS_PATH || "/terms-of-use";
    static readonly FRONTEND_RESET_PASSWORD_PATH = process.env.FRONTEND_RESET_PASSWORD_PATH || "/auth/reset-password";
    static readonly FRONTEND_FORGOT_PASSWORD_PATH = process.env.FRONTEND_FORGOT_PASSWORD_PATH || "/auth/forgot-password";
    static readonly FRONTEND_SUPPORT_EMAIL = process.env.FRONTEND_SUPPORT_EMAIL || "support@example.com";


    //GENERATED LINK : NOT MODIFY
    static readonly FRONTEND_LOGIN_LINK = MailService.FRONTEND_URL + MailService.FRONTEND_LOGIN_PATH;
    static readonly FRONTEND_REGISTER_LINK = MailService.FRONTEND_URL + MailService.FRONTEND_REGISTER_PATH;
    static readonly FRONTEND_PRIVACY_LINK = MailService.FRONTEND_URL + MailService.FRONTEND_PRIVACY_PATH;
    static readonly FRONTEND_TERMS_LINK = MailService.FRONTEND_URL + MailService.FRONTEND_TERMS_PATH;
    static readonly FRONTEND_RESET_PASSWORD_LINK = MailService.FRONTEND_URL + MailService.FRONTEND_RESET_PASSWORD_PATH;
    static readonly FRONTEND_FORGOT_PASSWORD_LINK = MailService.FRONTEND_URL + MailService.FRONTEND_FORGOT_PASSWORD_PATH;



    static readonly transporter = nodemailer.createTransport({
        host: MAIL_HOST,
        port: Number(MAIL_PORT),

        secure: false,
        auth: {
            user: MAIL_USER,
            pass: MAIL_PASS,
        },
    });

    static async sendMail(to: string, subject: string, html: string) {
        try {
            await MailService.transporter.sendMail({
                from: MailService.APPLICATION_NAME + " <" + MAIL_USER + ">",
                to,
                subject,
                html,
            });
        } catch (error: any) {
            Logger.error("MAIL /MailService/sendMail " + to + " content: " + html);
        }
    };


    static async sendWelcomeEmail(user: User | UserOmit) {

        const name = user.name || user.email;
        const email = user.email;

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'welcome.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            loginLink: MailService.FRONTEND_LOGIN_LINK,
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
        });

        await MailService.sendMail(email, 'Welcome to ' + MailService.APPLICATION_NAME, emailContent);
    };

    static async sendNewLoginEmail(user: User | UserOmit, session?: UserSession) {

        const name = user.name || user.email;
        const email = user.email;
        const location = session?.city + ", " + session?.state + ", " + session?.country;

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'new-login.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            device: session?.device || "Unknown",
            ip : session?.ip || "Unknown",
            location: location,
            loginTime: new Date().toLocaleString(),
            forgotPasswordLink: MailService.FRONTEND_FORGOT_PASSWORD_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
        });

        await MailService.sendMail(email, 'New Login Detected', emailContent);
    }


    static async sendForgotPasswordEmail(
        email: string, 
        name?: string | null,
        resetToken?: string) {

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'forgot-password.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            resetToken: resetToken,
            resetLink: MailService.FRONTEND_URL + MailService.FRONTEND_FORGOT_PASSWORD_PATH + "?token=" + resetToken,
            expiryTime: 1, // Expiry time in hours
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
        });


        await MailService.sendMail(email, 'Reset Your Password', emailContent);
    }

    static async sendPasswordResetSuccessEmail(
        email: string, 
        name?: string | null
    ) {
        
        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'password-reset.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            loginLink: MailService.FRONTEND_LOGIN_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
        });
  
        await MailService.sendMail(email, 'Password Reset Successful', emailContent);

    }

    static async sendOTPEmail(
        email: string, 
        name?: string | null, 
        otpToken?: string
    ) {

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'otp.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            loginLink: MailService.FRONTEND_LOGIN_LINK,
            resetPasswordLink: MailService.FRONTEND_RESET_PASSWORD_LINK,
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            otpToken: otpToken,
        });

        await MailService.sendMail(email, 'Your OTP Code', emailContent);

    }

    static async sendOTPEnabledEmail(email: string, name?: string) {
        
      
        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'otp-enabled.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            loginLink: MailService.FRONTEND_LOGIN_LINK,
            resetPasswordLink: MailService.FRONTEND_RESET_PASSWORD_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
        });

        
        await MailService.sendMail(email, 'OTP Enabled', emailContent);
    }
    

    static async sendOTPDisabledEmail(email: string, name?: string) {

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'otp-disabled.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            loginLink: MailService.FRONTEND_LOGIN_LINK,
            resetPasswordLink: MailService.FRONTEND_RESET_PASSWORD_LINK,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_TERMS_LINK,
            privacyLink: MailService.FRONTEND_PRIVACY_LINK,
        });

        await MailService.sendMail(email, 'OTP Disabled', emailContent);
    }

}
