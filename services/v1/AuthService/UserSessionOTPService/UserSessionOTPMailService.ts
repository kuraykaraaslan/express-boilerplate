import { OTPMethod, User, UserSession } from "@prisma/client";
import UserSessionOTPService from ".";
import MailService from "../../NotificationService/MailService";
import prisma from "../../../../libs/prisma";
import AuthMessages from "../../../../dictionaries/AuthMessages";
import bcrypt from "bcrypt";

export default class UserSessionOTPMailService {

    static async sendOTP({ user, userSession }: { user: User, userSession: UserSession }) {
        const otpToken = UserSessionOTPService.generateToken();
        const hashedOtp = await UserSessionOTPService.hashToken(otpToken);

        await prisma.userSessionOTP.upsert({
            where: {
                userSessionId_method: {
                    userSessionId: userSession.userSessionId,
                    method: OTPMethod.EMAIL,
                },
            },
            update: {
                code: hashedOtp,
                expiresAt: new Date(Date.now() + UserSessionOTPService.OTP_EXPIRY_MS),
            },
            create: {
                userSessionId: userSession.userSessionId,
                method: OTPMethod.EMAIL,
                code: hashedOtp,
                expiresAt: new Date(Date.now() + UserSessionOTPService.OTP_EXPIRY_MS),
            }
        });

        await MailService.sendOTPEmail({
            email: user.email,
            name: user.name,
            otpToken: otpToken,
        });

    }

    static async validateOTP({ userSession, otpToken }: { userSession: UserSession; otpToken: string }) {

        const userSessionOTP = await prisma.userSessionOTP.findUnique({
            where: {
                userSessionId_method: {
                    userSessionId: userSession.userSessionId,
                    method: OTPMethod.EMAIL,
                },
            },
        });

        if (!userSessionOTP) {
            throw new Error(AuthMessages.INVALID_OTP_METHOD);
        }

        const isExpired = userSessionOTP.expiresAt < new Date();

        if (isExpired) {
            throw new Error(AuthMessages.OTP_EXPIRED);
        }

        const isValid = await bcrypt.compare(otpToken, userSessionOTP.code!);

        if (!isValid) {
            throw new Error(AuthMessages.INVALID_OTP);
        }


        // TODO: Mark the OTP as verified

    }

}