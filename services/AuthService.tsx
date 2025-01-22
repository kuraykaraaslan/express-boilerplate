import { Role, UserSession, UserSocialAccount } from "@prisma/client";
import prisma from "../libs/prisma";
import bcrypt from "bcrypt";

// DTOs
import AuthRegisterRequest from "../dtos/requests/AuthRegisterRequest";
import AuthLoginRequest from "../dtos/requests/AuthLoginRequest";
import AuthResponse from "../dtos/responses/AuthResponse";
import AuthGetSessionRequest from "../dtos/requests/AuthGetSessionRequest";
import OmitPasswordUserResponse from "../dtos/responses/AuthUserResponse";
import AuthForgotPasswordRequest from "../dtos/requests/AuthForgotPasswordRequest";
import AuthResetPasswordRequest from "../dtos/requests/AuthResetPasswordRequest";
import FieldValidater from "../utils/FieldValidater";

// Other Services
import UserService from "./UserService";
import TwilloService from "./TwilloService";
import MailService from "./MailService";
import OauthService from "./SSOService";


// Utils
import { createId } from '@paralleldrive/cuid2';
import MessageResponse from "@/dtos/responses/MessageResponse";
import axios from "axios";
import AuthUserResponse from "../dtos/responses/AuthUserResponse";
import e from "express";
import AuthUserSessionResponse from "../dtos/responses/AuthUserSessionResponse";

export default class AuthService {

    /**
     * Error Messages
     * These are the error messages that can be thrown by the service.
     * TODO: Add more error messages as needed.
     */
    static INVALID_EMAIL_ADDRESS = "INVALID_EMAIL_ADDRESS";
    static PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS_LONG = "PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS_LONG";
    static PASSWORDS_DO_NOT_MATCH = "PASSWORDS_DO_NOT_MATCH";
    static REGISTRATION_SUCCESSFUL = "REGISTRATION_SUCCESSFUL";
    static LOGIN_SUCCESSFUL = "LOGIN_SUCCESSFUL";
    static PASSWORD_RESET_EMAIL_SENT = "PASSWORD_RESET_EMAIL_SENT";
    static PASSWORD_RESET_SUCCESSFUL = "PASSWORD_RESET_SUCCESSFUL";
    static PASSWORD_RESET_FAILED = "PASSWORD_RESET_FAILED";
    static UNKOWN_ERROR = "UNKOWN_ERROR";
    static INVALID_TOKEN = "INVALID_TOKEN";
    static SESSION_NOT_FOUND = "SESSION_NOT_FOUND";
    static USER_NOT_FOUND = "USER_NOT_FOUND";
    static EMAIL_ALREADY_EXISTS = "EMAIL_ALREADY_EXISTS";
    static INVALID_EMAIL_OR_PASSWORD = "INVALID_EMAIL_OR_PASSWORD";
    static INVALID_OTP = "INVALID_OTP";
    static OTP_EXPIRED = "OTP_EXPIRED";
    static USER_HAS_NO_PHONE_NUMBER = "USER_HAS_NO_PHONE_NUMBER";
    static USER_HAS_NO_EMAIL = "USER_HAS_NO_EMAIL";
    static OTP_ALREADY_ENABLED = "OTP_ALREADY_ENABLED";
    static OTP_ALREADY_DISABLED = "OTP_ALREADY_DISABLED";
    static OTP_CHANGED_SUCCESSFULLY = "OTP_CHANGED_SUCCESSFULLY";
    static INVALID_PROVIDER = "INVALID_PROVIDER";

    /**
     * Token Generation
     * @returns A random token 6 characters long with only numbers.
     */
    static generateToken(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /*
     * Generate Session CUID Token
    * @returns A random cuid token.
    */
    static generateSessionToken(): string {
        return createId();
    }


    /**
     * Hashes the password.
     * @param password - The password to hash.
     * @returns The hashed password.
     */
    static async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, 10);
    }

    /**
     * Remove Not Safe Variables from Session Object
     * @param session - The session object.
     * @returns The session object without the otpToken and otpTokenExpiry.
     */
    static omitSensitiveFields(session: UserSession): AuthUserSessionResponse {
        const fields = ['otpToken', 'otpTokenExpiry', 'createdAt', 'updatedAt'];
       
        const safeSession = {
            sessionId: session.sessionId,
            userId: session.userId,
            sessionToken: session.sessionToken,
            sessionExpiry: session.sessionExpiry,
            sessionAgent: session.sessionAgent,
            otpNeeded: session.otpNeeded,
        };        
        
        return safeSession;
    }


    /**
     * Authenticates a user by email and password.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The authenticated user.
     */
    static async login(data: AuthLoginRequest): Promise<AuthResponse> {

        // Get the user by email
        const user = await prisma.user.findUniqueOrThrow({
            where: { email: data.email },
        })

        // Omit sensitive fields from the user object
        UserService.omitSensitiveFields(user);

        // Compare the password with the hash
        if (!FieldValidater.comparePasswords(user.password, data.password)) {
            throw new Error(this.INVALID_EMAIL_OR_PASSWORD);
        }

        // Generate a session token
        const session = await prisma.userSession.create({
            data: {
                userId: user.userId,
                sessionToken: AuthService.generateSessionToken(),
                sessionExpiry: new Date(Date.now() + 3600000), // 1 hour
                sessionAgent: "Web",
                otpNeeded: user.otpEnabled,
            },
        });

        // Send Notification to User
        if (user.otpEnabled && user.phone) {
            TwilloService.sendSMS(user.phone, `Your OTP is ${session.otpToken}`);
        } else {
            TwilloService.sendSMS(user.phone, `You have logged in successfully.`);
        }

        // Send Mail to User
        if (user.otpEnabled && user.email) {
            MailService.sendMail(user.email, "OTP", `Your OTP is ${session.otpToken}`);
        } else {
            MailService.sendNewLoginEmail(user.email, user?.name ? user.name : undefined, undefined ,undefined,undefined);
        }

        return {
            user: UserService.omitSensitiveFields(user),
            userSession: AuthService.omitSensitiveFields(session),
        };
    }

    /**
     * Logs out a user by deleting the session.
     * @param token - The session token.
     */
    static async logout(data: AuthGetSessionRequest): Promise<void> {

        // Check if the session exists
        const sessions = await prisma.userSession.findMany({
            where: { sessionToken: data.sessionToken }
        });

        if (sessions.length === 0) {
            throw new Error("this.SESSION_NOT_FOUND");
        }

        // Delete the session if found
        await prisma.userSession.deleteMany({
            where: { sessionToken: data.sessionToken }
        });
    }


    /**
     * Gets a user session by token.
     * @param sessionToken - The session token.
     * @returns The user session.
     */
    static async getSession(data: AuthGetSessionRequest): Promise<AuthResponse> {

        console.log(data);

        const session = await prisma.userSession.findUnique({
            where: { sessionToken: data.sessionToken }
        })
        
        if (!session) {
            throw new Error(this.SESSION_NOT_FOUND);
        }

        const user = await prisma.user.findUniqueOrThrow({
            where: { userId: session.userId },
        })

        return {
            user: UserService.omitSensitiveFields(user),
            userSession: AuthService.omitSensitiveFields(session),
        };

    }

    /**
     * Deletes a user session by token.
     * @param token - The session token.
     */

    static async deleteSession(data: AuthGetSessionRequest): Promise<void> {

        await prisma.userSession.deleteMany({
            where: { sessionToken: data.sessionToken }
        });

    }

    /**
     * Registers a new user.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The registered user.
     */
    static async register(data: AuthRegisterRequest): Promise<MessageResponse> {

        const { email, name, password, phone } = data;

        // Check if the user already exists
        const existingUser = await UserService.getByEmail(email);

        if (existingUser) {
            throw new Error(this.EMAIL_ALREADY_EXISTS);
        }

        // Create the user
        const createdUser = await prisma.user.create({
            data: {
                email,
                password: await AuthService.hashPassword(password),
            },
        });

        // Send a welcome email
        MailService.sendWelcomeEmail(email, name);
        TwilloService.sendSMS(phone, "Welcome to our platform!");

        // Create a session for the user
        return { message: this.REGISTRATION_SUCCESSFUL };
    }

    /**
     * Checks if a user has the required role.
     * @param user - The user object.
     * @param requiredRoles - The required roles.
     * @returns Whether the user has the required role.
     */
    static checkIfUserHasRole(user: OmitPasswordUserResponse, requiredRole: string): boolean {

        const roles = [
            'SUPER_ADMIN',
            'ADMIN',
            'USER',
            'GUEST'
        ];

        const userRoleIndex = roles.indexOf(user.role);
        const requiredRoleIndex = roles.indexOf(requiredRole);

        return userRoleIndex <= requiredRoleIndex;
    }


    /**
     * Sends a password reset email to the user.
     * @param email - The user's email.
     */
    static async forgotPassword(data: AuthForgotPasswordRequest): Promise<void> {

        // Get the user by email
        let user = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (!user) {
            throw new Error(this.USER_NOT_FOUND);
        }

        const resetToken = AuthService.generateToken();

        // Save the token to the user
        user = await prisma.user.update({
            where: { userId: user.userId },
            data: {
                resetToken: resetToken,
                resetTokenExpiry: new Date(Date.now() + 3600000), // 1 hour
            },
        });

        // Send the password reset email
        MailService.sendForgotPasswordEmail(user.email, user.name || undefined, resetToken);
        TwilloService.sendSMS(user.phone, `Your password reset token is ${user.resetToken}`);

    }


    /**
     * Resets the password of the user.
     * @param token - The password reset token.
     * @param password - The new password.
     */
    static async resetPassword(data: AuthResetPasswordRequest): Promise<void> {

        // Get the user by token
        const user = await prisma.user.findFirst({
            where: { email: data.email },
        });

        if (!user) {
            throw new Error(this.USER_NOT_FOUND);
        }

        // Check if the token is valid
        if (user.resetToken !== data.resetToken || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
            throw new Error(this.INVALID_TOKEN);
        }

        // Update the user's password
        await prisma.user.update({
            where: { userId: user.userId },
            data: {
                password: await bcrypt.hash(data.password, 10),
                resetToken: null,
                resetTokenExpiry: null,
            },
        });

        // Notify the user
        MailService.sendPasswordResetSuccessEmail(user.email, user.name || undefined);
        TwilloService.sendSMS(user.phone, "Your password has been reset successfully.");

    }

    /**
     * Sends an OTP to the user.
     * @param sessionToken - The session token.
     * @param phone - The user's phone number.
     * @param method - The method to send the OTP (sms or email).
     */
    static async otpSend(sessionToken: string, method: string): Promise<MessageResponse> {

        // Get the session by token
        const session = await prisma.userSession.findUnique({
            where: { sessionToken },
        });

        if (!session) {
            throw new Error(this.SESSION_NOT_FOUND);
        }

        //if the session already has no otp needed
        if (!session.otpNeeded) {
            throw new Error("OTP_NOT_NEEDED");
        }

        // Generate an OTP
        const otpToken = AuthService.generateToken();

        // Save the OTP to the session
        await prisma.userSession.update({
            where: { sessionId: session.sessionId },
            data: {
                otpToken,
                otpTokenExpiry: new Date(Date.now() + 600000), // 10 minutes
            },
            include: { user: true },
        });

        const user = await prisma.user.findUnique({
            where: { userId: session.userId },
        });

        if (!user) {
            throw new Error(this.USER_NOT_FOUND);
        }

        // Send the OTP
        if (method === "sms") {
            if (user.phone) {
                TwilloService.sendSMS(user.phone, `Your OTP is ${otpToken}`);
            } else {
                throw new Error(this.USER_HAS_NO_PHONE_NUMBER);
            }
        } else if (method === "email") {
            if (user.email) {
                MailService.sendMail(user.email, "OTP", `Your OTP is ${otpToken}`);
            } else {
                throw new Error(this.USER_HAS_NO_EMAIL);
            }
        }

        return { message: "OTP_SENT" };
    }

    /**
     * Verifies the OTP of the user.
     * @param sessionToken - The session token.
     * @param otp - The OTP.
     */
    static async otpVerify(sessionToken: string, otp: string): Promise<MessageResponse> {

        // Get the session by token
        const session = await prisma.userSession.findUnique({
            where: { sessionToken },
        });

        if (!session) {
            throw new Error(this.SESSION_NOT_FOUND);
        }

        // Check if the OTP is expired
        if (session.otpTokenExpiry && new Date() > session.otpTokenExpiry) {
            throw new Error(this.OTP_EXPIRED);
        }

        // Check if the OTP is correct
        if (session.otpToken !== otp) {
            throw new Error(this.INVALID_OTP);
        }

        // Update the session
        await prisma.userSession.update({
            where: { sessionId: session.sessionId },
            data: {
                otpNeeded: false,
            },
        });

        return { message: "OTP_VERIFIED" };
    }


    /**
     * Changes the OTP status of the user.
     * @param user - The user object.
     * @param otpEnabled - Whether OTP is enabled.
     */
    static async otpChangeStatus(user: OmitPasswordUserResponse, otpEnabled: boolean): Promise<MessageResponse> {

        // If OTP is already enabled then throw an error
        if (otpEnabled && user.otpEnabled === otpEnabled) {
            throw new Error("OTP_ALREADY_ENABLED");
        } else if (!otpEnabled && user.otpEnabled === otpEnabled) {
            throw new Error("OTP_ALREADY_DISABLED");
        }

        // Update the user
        const updatedUser = await prisma.user.update({
            where: { userId: user.userId },
            data: {
                otpStatusChangeToken: AuthService.generateToken(),
                otpStatusChangeTokenExpiry: new Date(Date.now() + 600000), // 10 minutes
            },
        });

        // Send the OTP
        TwilloService.sendSMS(user.phone, `Your OTP is ${updatedUser.otpStatusChangeToken}`);
        MailService.sendMail(user.email, "OTP", `Your OTP is ${updatedUser.otpStatusChangeToken}`);

        return { message: "OTP_STATUS_CHANGE_SENT" };
    }

    /**
     * Verifies the OTP status change of the user.
     * @param user - The user object.
     * @param otpEnabled - Whether OTP is enabled.
     * @param otpStatusChangeToken - The OTP status change token.
     */
    static async otpChangeVerify(user: OmitPasswordUserResponse, otpEnabled: boolean, otpStatusChangeToken: string): Promise<MessageResponse> {

        // Check if the token is valid
        const updatedUser = await prisma.user.findUnique({
            where: { userId: user.userId },
        });


        if (!updatedUser?.otpStatusChangeTokenExpiry || new Date() > updatedUser.otpStatusChangeTokenExpiry) {
            throw new Error(this.INVALID_OTP);
        }

        if (!updatedUser || updatedUser.otpStatusChangeToken !== otpStatusChangeToken) {
            throw new Error(this.INVALID_OTP);
        }

        // if OTP is already enabled then throw an error
        if (otpEnabled && user.otpEnabled === otpEnabled) {
            // clear the token for security
            await prisma.user.update({
                where: { userId: user.userId },
                data: {
                    otpStatusChangeToken: null,
                    otpStatusChangeTokenExpiry: null,
                },
            });
            throw new Error(this.OTP_ALREADY_ENABLED);

        }

        if (!otpEnabled && user.otpEnabled === otpEnabled) {
            // clear the token for security
            await prisma.user.update({
                where: { userId: user.userId },
                data: {
                    otpStatusChangeToken: null,
                    otpStatusChangeTokenExpiry: null,
                },
            });
            throw new Error(this.OTP_ALREADY_DISABLED);
        }

        // Update the user
        await prisma.user.update({
            where: { userId: user.userId },
            data: {
                otpEnabled,
                otpStatusChangeToken: null,
                otpStatusChangeTokenExpiry: null,
            },
        });

        return { message: this.OTP_CHANGED_SUCCESSFULLY };
    }

}


