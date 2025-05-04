import { OTPMethod, User, UserSession } from "@prisma/client";
import UserSessionOTPService from ".";
import MailService from "../../NotificationService/MailService";
import prisma from "../../../../libs/prisma";
import AuthMessages from "../../../../dictionaries/AuthMessages";

// External Libraries
import { authenticator } from 'otplib';


export default class UserSessionOTPTOTPService {
    
    static async sendOTP({ user, userSession }: { user: User; userSession: UserSession }) {
        // NO NEED TO SEND OTP FOR TOTP
        throw new Error(AuthMessages.INVALID_OTP_METHOD);
    }

    static async validateOTP({ user, userSession, otpToken }: { user: User; userSession: UserSession; otpToken: string }) {

        // No need to check if userSessionOTP exists Because TOTP is always valid

        if (!user.otpSecret) {
            throw new Error(AuthMessages.INVALID_OTP_METHOD);
        }

        // Check if the OTP token is valid
        const isValid = authenticator.check(otpToken, user.otpSecret);

        if (!isValid) {
            throw new Error(AuthMessages.INVALID_OTP);
        }

        // TODO: Mark the OTP as verified

    }

}
