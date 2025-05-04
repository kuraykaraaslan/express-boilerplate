import { OTPMethod, User, UserSession } from "@prisma/client";
import UserSessionOTPService from ".";
import MailService from "../../NotificationService/MailService";
import prisma from "../../../../libs/prisma";
import SMSService from "../../NotificationService/SMSService";
import AuthMessages from "../../../../dictionaries/AuthMessages";
import bcrypt from "bcrypt";

export default class UserSessionOTPSMSService {

    static async sendOTP({ user, userSession }: { user: User, userSession: UserSession }) {
        const otpToken = UserSessionOTPService.generateToken();
        const hashedOtp = await UserSessionOTPService.hashToken(otpToken);

        // Check if the user has a phone number
        if (!user.phone) {
            throw new Error("User does not have a phone number.");
        }

        await prisma.userSessionOTP.upsert({
            where: {
                userSessionId_method: {
                    userSessionId: userSession.userSessionId,
                    method: OTPMethod.SMS
                },
            },
            update: {
                code: hashedOtp,
                expiresAt: new Date(Date.now() + UserSessionOTPService.OTP_EXPIRY_MS),
            },
            create: {
                userSessionId: userSession.userSessionId,
                method: OTPMethod.SMS,
                code: hashedOtp,
                expiresAt: new Date(Date.now() + UserSessionOTPService.OTP_EXPIRY_MS),
            }
        });

        await SMSService.sendShortMessage({ to: user.phone, body: `Your OTP code is ${otpToken}. It is valid for 10 minutes.` });

    }

    static async validateOTP({ userSession, otpToken }: { userSession: UserSession; otpToken: string }) {

        const userSessionOTP = await prisma.userSessionOTP.findUnique({
            where: {
                userSessionId_method: {
                    userSessionId: userSession.userSessionId,
                    method: OTPMethod.SMS,
                },
            },
        });

        if (!userSessionOTP) {
            throw new Error("Invalid OTP method.");
        }

        const isExpired = userSessionOTP.expiresAt < new Date();

        if (isExpired) {
            throw new Error("OTP has expired.");
        }

        const isValid = await UserSessionOTPService.compareToken(otpToken, userSessionOTP.code!);
        if (!isValid) throw new Error(AuthMessages.INVALID_OTP);

        await UserSessionOTPService.markAsVerified(userSession.userSessionId);

    }
}