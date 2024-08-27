import { Twilio } from 'twilio';
import axios from 'axios';

export class SendSMS {

    public static async sendOTPbyTwillo(phone: string, message: string): Promise<void> {

        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
            console.error("Twilio credentials not found");
            throw new Error("ERROR_SENDING_SMS");
        }

        const client = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

        await client.messages
            .create({
                body: message,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: phone
            })
            .then(message => console.log(message.sid))
            .catch((err) => {
                console.error(err);
                throw new Error("ERROR_SENDING_SMS");
            });

    }

    public static async sendOTPbySMS(phone: string, message: string): Promise<void> {

        // PHONE_NUMBER is the phone number of the recipient and starts with the country code with plus sign
        // For example, +905555555555
        // if it is +90, it is the country code of Turkey then use NETGSM
        // if it is other than +90, it is the country code of another country then use TWILIO

        if (phone.startsWith("+90")) {
            const targetPhone = phone.replace("+90", "");
            await this.sendOTPbyNETGSM(phone, message);
        } else {
            const targetPhone = phone;
            await this.sendOTPbyTwillo(phone, message);
        }

    }


    public static async sendOTPbyNETGSM(phone: string, message: string): Promise<void> {

        if (!process.env.NETGSM_USER_CODE || !process.env.NETGSM_SECRET_CODE || !process.env.NETGSM_PHONE_NUMBER) {
            console.error("NETGSM credentials not found");
            throw new Error("ERROR_SENDING_SMS");
        }

        if (!process.env.NETGSM_APP_KEY) {
            console.error("NETGSM APP KEY not found");
            throw new Error("ERROR_SENDING_SMS");
        }


        const formData = new FormData();

        /*
        usercode : 850XXXXXXX
        password : XXXX
        gsmno : 5XXXXXXXXXX
        message : testmesajı
        msgheader : mesajbaşlığı
        filter : 0
        appkey : xxx
        */

        formData.append("usercode", process.env.NETGSM_USER_CODE);
        formData.append("password", process.env.NETGSM_SECRET_CODE);
        formData.append("gsmno", phone);
        formData.append("message", "Your verification code is: " + message);
        formData.append("msgheader", process.env.NETGSM_PHONE_NUMBER);
        formData.append("filter", "0");
        formData.append("appkey", process.env.NETGSM_APP_KEY);

        try {
        await axios.post("https://api.netgsm.com.tr/sms/send/get", formData)
            .then((response) => {
                console.log(response.data);
            })
            .catch((err) => {
                console.error(err);
                throw new Error("ERROR_SENDING_SMS");
            });

        } catch (error) {
            console.error(error);
            throw new Error("ERROR_SENDING_SMS");
        }
        
    }

}