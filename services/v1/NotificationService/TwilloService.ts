// Libraries
import twilio from 'twilio';

// Utils
import Logger from './../../../libs/logger';

export default class TwilloService {
    private static _initialized = false;
    private static readonly accountSid = process.env.TWILIO_ACCOUNT_SID;
    private static readonly authToken = process.env.TWILIO_AUTH_TOKEN;

    private static readonly client = twilio(TwilloService.accountSid, TwilloService.authToken);

    static {
        if (!TwilloService._initialized) {
            if (!TwilloService.accountSid || !TwilloService.authToken) {
                Logger.error("SMS /TwilloService Twilio credentials are missing.");
            } else {
                Logger.info("SMS /TwilloService initialized successfully.");
                TwilloService._initialized = true;
            }
        }
    }

    static async sendSMS(to: string | string[] | undefined | null, message: string) {
        if (!to) {
            Logger.error("SMS /TwilloService/sendSMS No phone number provided.");
            return;
        }

        const targets = Array.isArray(to) ? to : [to];

        for (const target of targets) {
            try {
                Logger.info(`SMS /TwilloService/sendSMS Sending to ${target} → "${message}"`);
                await TwilloService.client.messages.create({
                    body: message,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to: target,
                });
                Logger.info(`SMS /TwilloService/sendSMS Sent to ${target}`);
            } catch (error: any) {
                Logger.error(`SMS /TwilloService/sendSMS Failed to send to ${target}. Error: ${error.message}`);
            }
        }
    }
}
