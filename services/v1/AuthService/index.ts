import prisma from "../../../libs/prisma";
import bcrypt from "bcrypt";

// DTOs
import LoginRequest from "../../../dtos/requests/auth/LoginRequest";
import GetSessionRequest from "../../../dtos/requests/auth/GetSessionRequest";
import RegisterRequest from "../../../dtos/requests/auth/RegisterRequest";


// Other Services
import UserService from "../UserService";
import SMSService from "../NotificationService/SMSService";
import MailService from "../NotificationService/MailService";

// Utils
import FieldValidater from "../../../utils/FieldValidater";
import SafeUser from "../../../types/SafeUser";
import AuthMessages from "../../../dictionaries/AuthMessages";


import { User } from "@prisma/client";
export default class AuthService {

    static readonly SafeUserSelect = {
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
    static async login(data: LoginRequest): Promise<SafeUser> {

        // Get the user by email
        const user = await prisma.user.findUnique({
            where: { email: data.email },
        })

        if (!user) {
            throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401);
        }

        // Compare the password with the hash

        if (!await FieldValidater.comparePasswords(user.password, data.password)) {
            throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401);
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
            throw new AppError(AuthMessages.SESSION_NOT_FOUND, 403);
        }

        // Delete the session if found
        await prisma.userSession.deleteMany({
            where: { accessToken: data.accessToken }
        });
    }


    /**
     * Registers a new user.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The registered user.
     */
    static async register(data: RegisterRequest): Promise<SafeUser> {

        const { email, name, password, phone } = data;

        // Check if the user already exists
        const existingUser = await UserService.getByEmail(email);

        if (existingUser) {
            throw new AppError(AuthMessages.EMAIL_ALREADY_EXISTS);
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
        SMSService.sendShortMessage({
            to: createdUser.phone!,
            body: `Welcome ${createdUser.name || createdUser.email}! Your account has been created successfully.`,
        });

        // Create a session for the user
        return UserService.omitSensitiveFields(createdUser);
    }

    /**
     * Checks if a user has the required role.
     * @param user - The user object.
     * @param requiredRoles - The required roles.
     * @returns Whether the user has the required role.
     */
    public static checkIfUserHasRole(user: SafeUser, requiredRole: string): boolean {

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



}


