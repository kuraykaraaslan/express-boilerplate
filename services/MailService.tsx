import Logger from '../libs/logger';
import nodemailer from 'nodemailer';
import ejs from 'ejs';
import path from 'path';

const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env;

export default class MailService {

    static TEMPLATE_PATH = path.join(__dirname, '../views/email/');
    static APPLICATION_NAME = process.env.APPLICATION_NAME || "Express Boilerplate";

    // These are the default values, you can change them in the .env file
    static FRONTEND_URL = process.env.FRONTEND_HOST + ":" + process.env.FRONTEND_PORT;

    static FRONTEND_WELCOME_PATH = process.env.FRONTEND_WELCOME_PATH || "#";
    static FRONTEND_SUPPORT_EMAIL = process.env.FRONTEND_SUPPORT_EMAIL || "#"
    static FRONTEND_PRIVACY_PATH = process.env.FRONTEND_PRIVACY_PATH || "#";
    static FRONTEND_TERMS_PATH = process.env.FRONTEND_TERMS_PATH || "#";
    static FRONTEND_RESET_PASSWORD_PATH = process.env.FRONTEND_RESET_PASSWORD_PATH || "#";
    static FRONTEND_FORGOT_PASSWORD_PATH = process.env.FRONTEND_FORGOT_PASSWORD_PATH || "#";


    static transporter = nodemailer.createTransport({
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
                from: MAIL_USER,
                to,
                subject,
                html,
            });
        } catch (error: any) {
            Logger.error("MAIL /MailService/sendMail " + to + " content: " + html);
        }
    };


    static async sendWelcomeEmail(email: string, name?: string) {

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'welcome.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            welcomeLink: MailService.FRONTEND_URL + MailService.FRONTEND_WELCOME_PATH,
            termsLink: MailService.FRONTEND_URL + MailService.FRONTEND_TERMS_PATH,
            privacyLink: MailService.FRONTEND_URL + MailService.FRONTEND_PRIVACY_PATH,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
        });

        await MailService.sendMail(email, 'Welcome to ' + MailService.APPLICATION_NAME, emailContent);
    };

    static async sendNewLoginEmail(email: string, name?: string, device?: string, ipAddress?: string, location?: string, loginTime?: string) {


        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'new-login.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            device: device || 'Unknown Device',
            ipAddress: ipAddress || 'Unknown IP Address',
            location: location || 'Unknown Location',
            loginTime: loginTime || new Date().toLocaleString(),
            resetPasswordLink: MailService.FRONTEND_URL + MailService.FRONTEND_RESET_PASSWORD_PATH,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_URL + MailService.FRONTEND_TERMS_PATH,
            privacyLink: MailService.FRONTEND_URL + MailService.FRONTEND_PRIVACY_PATH,
        });

        await MailService.sendMail(email, 'New Login Detected', emailContent);
    }


    static async sendForgotPasswordEmail(email: string, name?: string, resetToken?: string) {

        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'forgot-password.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            resetToken: resetToken,
            resetLink: MailService.FRONTEND_URL + MailService.FRONTEND_FORGOT_PASSWORD_PATH + "?token=" + resetToken,
            expiryTime: 1, // Expiry time in hours
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_URL + MailService.FRONTEND_TERMS_PATH,
            privacyLink: MailService.FRONTEND_URL + MailService.FRONTEND_PRIVACY_PATH,
        });


        await MailService.sendMail(email, 'Reset Your Password', emailContent);
    }

    static async sendPasswordResetSuccessEmail(email: string, name?: string) {
        
        const emailContent = await ejs.renderFile(path.join(MailService.TEMPLATE_PATH, 'password-reset.ejs'), {
            user: { name: name || email },
            appName: MailService.APPLICATION_NAME,
            loginLink: MailService.FRONTEND_URL + MailService.FRONTEND_WELCOME_PATH,
            supportEmail: MailService.FRONTEND_SUPPORT_EMAIL,
            termsLink: MailService.FRONTEND_URL + MailService.FRONTEND_TERMS_PATH,
            privacyLink: MailService.FRONTEND_URL + MailService.FRONTEND_PRIVACY_PATH,
        });
  
        await MailService.sendMail(email, 'Password Reset Successful', emailContent);

    }
}