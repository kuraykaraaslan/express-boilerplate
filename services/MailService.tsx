import Logger from '../libs/logger';
import nodemailer from 'nodemailer';

const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS } = process.env;

export default class MailService {
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
    }
}

