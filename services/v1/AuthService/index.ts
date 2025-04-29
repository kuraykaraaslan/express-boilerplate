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
import AuthErrors from "../../../errors/AuthErrors";


export default class AuthService {

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



    /**
     * Token Generation
     * @returns A random token 6 characters long with only numbers.
     */
    static generateToken(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
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
            throw new Error(AuthErrors.INVALID_EMAIL_OR_PASSWORD);
        }

        // Compare the password with the hash

        if (!await FieldValidater.comparePasswords(user.password, data.password)) {
            throw new Error(AuthErrors.INVALID_EMAIL_OR_PASSWORD);
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
            throw new Error(AuthErrors.SESSION_NOT_FOUND);
        }

        // Delete the session if found
        await prisma.userSession.deleteMany({
            where: { accessToken: data.accessToken }
        });
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
            throw new Error(AuthErrors.EMAIL_ALREADY_EXISTS);
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
            throw new Error(AuthErrors.USER_NOT_FOUND);
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
            throw new Error(AuthErrors.USER_NOT_FOUND);
        }

        // Check if the token is valid
        if (user.resetToken !== data.resetToken || !user.resetTokenExpiry || new Date() > user.resetTokenExpiry) {
            throw new Error(AuthErrors.INVALID_TOKEN);
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

}


