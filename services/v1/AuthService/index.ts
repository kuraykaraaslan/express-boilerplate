import {  UserSession } from "@prisma/client";
import { Request } from "express";
import prisma from "../../../libs/prisma";
import bcrypt from "bcrypt";

// DTOs
import LoginResponse from "../../../dtos/responses/auth/LoginResponse";
import MessageResponse from "../../../dtos/responses/MessageResponse";
import LoginRequest from "../../../dtos/requests/auth/LoginRequest";
import ForgotPasswordRequest from "../../../dtos/requests/auth/ForgotPasswordRequest";
import ResetPasswordRequest from "../../../dtos/requests/auth/ResetPasswordRequest";
import GetSessionRequest from "../../../dtos/requests/auth/GetSessionRequest";
import RegisterRequest from "../../../dtos/requests/auth/RegisterRequest";


// Other Services
import UserService from "../UserService";
import TwilloService from "../NotificationService/TwilloService";
import MailService from "../NotificationService/MailService";

// Utils
import FieldValidater from "../../../utils/FieldValidater";
import UserAgentUtil from "../../../utils/UserAgentUtil";
import UserSessionOmit from "../../../types/UserSessionOmit";
import UserOmit from "../../../types/UserOmit";
import VerifyOTPRequest from "../../../dtos/requests/auth/VerifyOTPRequest";
import SendOTPRequest from "../../../dtos/requests/auth/SendOTPRequest";
import ChangeOTPStatusRequest from "../../../dtos/requests/auth/ChangeOTPStatusRequest";
import ChangeOTPVerifyRequest from "../../../dtos/requests/auth/ChangeOTPVerifyRequest";

import jwt from 'jsonwebtoken';
import TenantService from "../TenantService";
import TenantUserService from "../TenantService/TenantUserService";


const ACCESS_TOKEN_SECRET: jwt.Secret = process.env.ACCESS_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h'; // veya '1h' gibi

const REFRESH_TOKEN_SECRET: jwt.Secret = process.env.REFRESH_TOKEN_SECRET!;
const REFRESH_TOKEN_EXPIRES_IN: string | number = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'; // veya '7d' gibi

export default class AuthService {

    /**
     * Error Messages
     * These are the error messages that can be thrown by the service.
     * TODO: Add more error messages as needed.
     */
    static readonly EITHER_EMAIL_OR_PHONE_MUST_BE_PROVIDED = "EITHER_EMAIL_OR_PHONE_MUST_BE_PROVIDED";
    static readonly INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
    static readonly INVALID_PASSWORD = "INVALID_PASSWORD";
    static readonly INVALID_PHONE_NUMBER = "INVALID_PHONE_NUMBER";
    static readonly INVALID_EMAIL_ADDRESS = "INVALID_EMAIL_ADDRESS";
    static readonly PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS_LONG = "PASSWORD_MUST_BE_AT_LEAST_8_CHARACTERS_LONG";
    static readonly PASSWORDS_DO_NOT_MATCH = "PASSWORDS_DO_NOT_MATCH";
    static readonly REGISTRATION_SUCCESSFUL = "REGISTRATION_SUCCESSFUL";
    static readonly LOGIN_SUCCESSFUL = "LOGIN_SUCCESSFUL";
    static readonly PASSWORD_RESET_EMAIL_SENT = "PASSWORD_RESET_EMAIL_SENT";
    static readonly PASSWORD_RESET_SUCCESSFUL = "PASSWORD_RESET_SUCCESSFUL";
    static readonly PASSWORD_RESET_FAILED = "PASSWORD_RESET_FAILED";
    static readonly UNKNOWN_ERROR = "UNKNOWN_ERROR";
    static readonly INVALID_TOKEN = "INVALID_TOKEN";
    static readonly SESSION_NOT_FOUND = "SESSION_NOT_FOUND";
    static readonly USER_NOT_FOUND = "USER_NOT_FOUND";
    static readonly EMAIL_ALREADY_EXISTS = "EMAIL_ALREADY_EXISTS";
    static readonly INVALID_EMAIL_OR_PASSWORD = "INVALID_EMAIL_OR_PASSWORD";
    static readonly INVALID_OTP = "INVALID_OTP";
    static readonly OTP_EXPIRED = "OTP_EXPIRED";
    static readonly USER_HAS_NO_PHONE_NUMBER = "USER_HAS_NO_PHONE_NUMBER";
    static readonly USER_HAS_NO_EMAIL = "USER_HAS_NO_EMAIL";
    static readonly OTP_ALREADY_ENABLED = "OTP_ALREADY_ENABLED";
    static readonly OTP_ALREADY_DISABLED = "OTP_ALREADY_DISABLED";
    static readonly OTP_CHANGED_SUCCESSFULLY = "OTP_CHANGED_SUCCESSFULLY";
    static readonly INVALID_PROVIDER = "INVALID_PROVIDER";
    static readonly INVALID_PROVIDER_TOKEN = "INVALID_PROVIDER_TOKEN";
    static readonly OTP_SENT_SUCCESSFULLY = "OTP_SENT_SUCCESSFULLY";
    static readonly OTP_VERIFIED_SUCCESSFULLY = "OTP_VERIFIED_SUCCESSFULLY";
    static readonly PHONE_ALREADY_EXISTS = "PHONE_ALREADY_EXISTS";
    static readonly LOGGED_OUT_SUCCESSFULLY = "LOGGED_OUT_SUCCESSFULLY";

    static readonly UserOmitSelect = {
        userId: true,
        email: true,
        name: true,
        phone: true,
        userRole: true,
        otpEnabled: true,
        createdAt: true,
        updatedAt: true,
    };

    static readonly UserSessionOmitSelect = {
        userId: true,
        sessionId: true,
        accessToken: true,
        refreshToken: true,
        tenantId: true,
        tenantUserId: true,
        tenant: {
            select: TenantService.TenantOmitSelect, 
        },
        tenantUser: {
            select: TenantUserService.TenantUserOmitSelect,
        },
    }


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
    private static generateAccessToken(userId: string): string {
        // @ts-ignore
        return jwt.sign({ userId }, ACCESS_TOKEN_SECRET, {
            expiresIn: ACCESS_TOKEN_EXPIRES_IN,
        });
    }   

    /**
     * Generate Refresh Token
     * @returns A random refresh token.
     */
    private static generateRefreshToken(userId: string): string {
        // @ts-ignore
        return jwt.sign({ userId }, REFRESH_TOKEN_SECRET, { 
            expiresIn: REFRESH_TOKEN_EXPIRES_IN,
        });
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
    static omitSensitiveFields(session: UserSession): UserSessionOmit {

        const safeSession = {
            userId: session.userId,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            otpNeeded: session.otpNeeded,
            tenantUserId: session.tenantUserId,
            tenantId: session.tenantId,
        };        
        
        return safeSession;
    }


    /**
     * Authenticates a user by email and password.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The authenticated user.
     */
    static async login(data: LoginRequest): Promise<UserOmit> {

        // Get the user by email
        const user = await prisma.user.findUnique({
            where: { email: data.email },
        })

        if (!user) {
            throw new Error(this.INVALID_EMAIL_OR_PASSWORD);
        }

        // Compare the password with the hash

        if (!await FieldValidater.comparePasswords(user.password, data.password)) {
            throw new Error(this.INVALID_EMAIL_OR_PASSWORD);
        }

        return UserService.omitSensitiveFields(user);
    }

    /**
     * Logs out a user by deleting the session.
     * @param token - The session token.
     */
    static async logout(data: GetSessionRequest): Promise<void> {

        // Check if the session exists
        const sessions = await prisma.userSession.findMany({
            where: { accessToken: data.accessToken }
        });

        if (sessions.length === 0) {
            throw new Error(this.SESSION_NOT_FOUND);
        }

        // Delete the session if found
        await prisma.userSession.deleteMany({
            where: { accessToken: data.accessToken }
        });
    }

    /**
     * Creates a new user session.
     * @param userId - The user ID.
     * @returns The created session.
     */    
    static async createSession(user: UserOmit, request: Request<any>, otpConsired: boolean = false): Promise<UserSession> {

        const userAgentData = await UserAgentUtil.parseRequest(request);

        return prisma.userSession.create({
            data: {
                userId: user.userId,
                accessToken: AuthService.generateAccessToken(user.userId),
                refreshToken: AuthService.generateRefreshToken(user.userId),
                sessionExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                sessionAgent: "Web",
                otpNeeded: otpConsired ? user.otpEnabled : false,
                ip: userAgentData.ip || "Unknown",
                os: userAgentData.os || "Unknown",
                device: userAgentData.device || "Unknown",
                browser: userAgentData.browser || "Unknown",
                city: userAgentData.city || "Unknown",
                state: userAgentData.state || "Unknown",
                country: userAgentData.country || "Unknown",
            },
        });
    }

    /**
     * Gets a user session by token.
     * @param accessToken - The session token.
     * @returns The user session.
     */
    static async getSession(data: GetSessionRequest): Promise<LoginResponse> {

        const session = await prisma.userSession.findUnique({
            where: { accessToken: data.accessToken },
            select: AuthService.UserSessionOmitSelect,
        })
        
        if (!session) {
            throw new Error(this.SESSION_NOT_FOUND);
        }

        const user = await prisma.user.findUniqueOrThrow({
            where: { userId: session.userId },
        })

        return {
            user: UserService.omitSensitiveFields(user),
            //@ts-ignore
            userSession: AuthService.omitSensitiveFields(session),
        };

    }

    /**
     * Deletes a user session by token.
     * @param token - The session token.
     */

    static async deleteSession(data: UserSessionOmit): Promise<void> {

        await prisma.userSession.deleteMany({
            where: { accessToken: data.accessToken }
        });

    }

    /**
     * Destroy all other sessions of the user.
     * 
     * @param userSession - The current user session.
     * @returns A promise that resolves when the sessions are destroyed.
     */
        static async destroyOtherSessions({ user, userSession }: LoginResponse): Promise<void> {
        // Get all sessions of the user
        const sessions = await prisma.userSession.findMany({
            where: { userId: user.userId },
        });
        // Delete all sessions except the current one
        await prisma.userSession.deleteMany({
            where: {
                userId: user.userId,
                accessToken: {
                    not: userSession.accessToken,
                },  
            },
        });
    }  

        
    /**
     * Registers a new user.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The registered user.
     */
    static async register(data: RegisterRequest): Promise<UserOmit> {

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
        MailService.sendWelcomeEmail(createdUser);
        TwilloService.sendSMS(phone, "Welcome to our platform!");

        // Create a session for the user
        return UserService.omitSensitiveFields(createdUser);    
    }

    /**
     * Checks if a user has the required role.
     * @param user - The user object.
     * @param requiredRoles - The required roles.
     * @returns Whether the user has the required role.
     */
    public static checkIfUserHasRole(user: UserOmit, requiredRole: string): boolean {

        const roles = [
            'SUPER_ADMIN',
            'ADMIN',
            'USER',
            'GUEST'
        ];

        const userRoleIndex = roles.indexOf(user.userRole);
        const requiredRoleIndex = roles.indexOf(requiredRole);

        return userRoleIndex <= requiredRoleIndex;
    }


    /**
     * Sends a password reset email to the user.
     * @param email - The user's email.
     */
    static async forgotPassword(data: ForgotPasswordRequest): Promise<void> {

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
    static async resetPassword(data: ResetPasswordRequest): Promise<void> {

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
     * @param accessToken - The session token.
     * @param phone - The user's phone number.
     * @param method - The method to send the OTP (sms or email).
     */
    static async otpSend(data: SendOTPRequest): Promise<MessageResponse> {

        // Get the session by token
        const session = await prisma.userSession.findUnique({
            where: { accessToken: data.accessToken},
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

        switch (data.method) {
            case "sms":
                if (user.phone) {
                    TwilloService.sendSMS(user.phone, `Your OTP is ${otpToken}`);
                } else {
                    throw new Error(this.USER_HAS_NO_PHONE_NUMBER);
                }
                break;
            case "email":
                if (user.email) {
                    MailService.sendMail(user.email, "OTP", `Your OTP is ${otpToken}`);
                } else {
                    throw new Error(this.USER_HAS_NO_EMAIL);
                }
                break;
            default:
                throw new Error("INVALID_METHOD");
        }

        return { message: this.OTP_SENT_SUCCESSFULLY };
    }

    /**
     * Verifies the OTP of the user.
     * @param accessToken - The session token.
     * @param otp - The OTP.
     */
    static async otpVerify(data: VerifyOTPRequest): Promise<MessageResponse> {

        // Get the session by token
        const session = await prisma.userSession.findUnique({
            where: { accessToken: data.accessToken },
        });

        if (!session) {
            throw new Error(this.SESSION_NOT_FOUND);
        }

        // Check if the OTP is expired
        if (session.otpTokenExpiry && new Date() > session.otpTokenExpiry) {
            throw new Error(this.OTP_EXPIRED);
        }

        // Check if the OTP is correct
        if (session.otpToken !== data.otpToken) {
            throw new Error(this.INVALID_OTP);
        }

        // Update the session
        await prisma.userSession.update({
            where: { sessionId: session.sessionId },
            data: {
                otpNeeded: false,
            },
        });

        return { message: this.OTP_VERIFIED_SUCCESSFULLY };
    }


    /**
     * Changes the OTP status of the user.
     * @param user - The user object.
     * @param otpEnabled - Whether OTP is enabled.
     */
    static async otpChangeStatus(user: UserOmit, data: ChangeOTPStatusRequest): Promise<MessageResponse> {
        // If OTP is already enabled then throw an error
        if (data.otpEnabled && user.otpEnabled === data.otpEnabled) {
            throw new Error("OTP_ALREADY_ENABLED");
        } else if (!data.otpEnabled && user.otpEnabled === data.otpEnabled) {
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
        if (updatedUser.otpStatusChangeToken) {
            TwilloService.sendSMS(user.phone, `Your OTP is ${updatedUser.otpStatusChangeToken}`);
            MailService.sendOTPEmail(user.email, user.name, updatedUser.otpStatusChangeToken);
        }

        return { message: this.OTP_CHANGED_SUCCESSFULLY };
    }

    /**
     * Verifies the OTP status change of the user.
     * @param user - The user object.
     * @param otpEnabled - Whether OTP is enabled.
     * @param otpStatusChangeToken - The OTP status change token.
     */
    static async otpChangeVerify(user: UserOmit, data: ChangeOTPVerifyRequest): Promise<MessageResponse> {

        // Check if the token is valid
        const updatedUser = await prisma.user.findUnique({
            where: { userId: user.userId },
        });


        if (!updatedUser?.otpStatusChangeTokenExpiry || new Date() > updatedUser.otpStatusChangeTokenExpiry) {
            throw new Error(this.INVALID_OTP);
        }

        if (!updatedUser || updatedUser.otpStatusChangeToken !== data.otpStatusChangeToken) {
            throw new Error(this.INVALID_OTP);
        }

        // if OTP is already enabled then throw an error
        if (data.otpEnabled && user.otpEnabled === data.otpEnabled) {
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

        if (!data.otpEnabled && user.otpEnabled === data.otpEnabled) {
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
                otpEnabled : data.otpEnabled,
                otpStatusChangeToken: null,
                otpStatusChangeTokenExpiry: null,
            },
        });


        if (data.otpEnabled) {
            // Send the OTP
            MailService.sendOTPEnabledEmail(user.email, user.name || undefined);
        } else {
            // Send the OTP
            MailService.sendOTPDisabledEmail(user.email, user.name || undefined);
        }

        return { message: this.OTP_CHANGED_SUCCESSFULLY };
    }


    public static async refreshAccessToken(accessToken: string): Promise<UserSessionOmit | null> {
        const session = await prisma.userSession.findFirst({
            where: {
                accessToken,
                sessionExpiry: {
                    gt: new Date(),
                },
            },
        });
    
        if (!session) {
            throw new Error(AuthService.SESSION_NOT_FOUND);
        }
    
        const newRefreshToken = AuthService.generateRefreshToken(session.userId);
        const newAccessToken = AuthService.generateAccessToken(session.userId);
        
        /*
        const updatedSession = await prisma.userSession.update({
          where: { sessionId: session.sessionId },
          data: {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            sessionExpiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
          },
        });
        */
        
        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            otpNeeded: session.otpNeeded,
            tenantId: session.tenantId,
            tenantUserId: session.tenantUserId,
            userId: session.userId,
        }
    }


}


