import twilio from 'twilio';
import Logger from '../libs/logger';

export default class TwilloService {
    private static accountSid = process.env.TWILIO_ACCOUNT_SID;
    private static authToken = process.env.TWILIO_AUTH_TOKEN;
    private static client = twilio(TwilloService.accountSid, TwilloService.authToken);

    static async sendSMS(to: string | string[] | undefined | null, message: string) {

        if (!to) {
            //sliently return if no phone number is provided
            return;
        }
        try {

            const target = Array.isArray(to) ? to : [to];

            for (const to of target) {
                await TwilloService.client.messages.create({
                    body: message,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    to
                });
            }

        } catch (error) {
            Logger.error("SMS /TwilloService/sendSMS " + to + " content: " + message);
        }
    }

}