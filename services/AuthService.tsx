import { User } from "@prisma/client";
import prisma from "../libs/prisma";
import bcrypt from "bcrypt";

// DTOs
import AuthRegisterRequest from "@/dtos/requests/AuthRegisterRequest";
import AuthLoginRequest from "@/dtos/requests/AuthLoginRequest";
import UserSessionResponse from "@/dtos/responses/UserSessionResponse";
import GetSessionRequest from "@/dtos/requests/GetSessionRequest";
import OmitPasswordUserResponse from "@/dtos/responses/OmitPasswordUserResponse";

export default class AuthService {

    /**
     * Authenticates a user by email and password.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The authenticated user.
     */
    static async authenticate(data: AuthLoginRequest): Promise<UserSessionResponse> {

        const { email, password } = data;

        // Get the user by email
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new Error("INVALID_EMAIL_OR_PASSWORD");
        }

        // Remove the password from the user object
        const { password: _, ...userWithoutPassword } = user;

        // Compare the password with the hash
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            throw new Error("INVALID_EMAIL_OR_PASSWORD");
        }

        // Create a user session
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const session = await prisma.userSession.create({
            data: {
                userId: user.userId,
                token,
            },
        });
        
        return {
            user : userWithoutPassword,
            session,
        };
    }

    /**
     * Logs out a user by deleting the session.
     * @param token - The session token.
     */
    static async logout(data : GetSessionRequest): Promise<void> {

        const { token } = data;
        
        const session = await prisma.userSession.findMany({
            where: { token },
        });

        if (!session) {
            throw new Error("SESSION_NOT_FOUND");
        }

        await prisma.userSession.deleteMany({
            where: { token },
        });

        
    }

    /**
     * Gets a user session by token.
     * @param token - The session token.
     * @returns The user session.
     */
    static async getSession(data: GetSessionRequest): Promise<UserSessionResponse> {

        const { token } = data;

        const session = await prisma.userSession.findFirst({
            where: { token },
        });

        if (!session) {
            throw new Error("SESSION_NOT_FOUND");
        }

        const user = await prisma.user.findUnique({
            where: { userId: session.userId },
        });

        if (!user) {
            throw new Error("USER_NOT_FOUND");
        }

        // Remove the password from the user object
        const { password: _, ...userWithoutPassword } = user;

        return {
            user: userWithoutPassword,
            session,
        };

    }

    /**
     * Deletes a user session by token.
     * @param token - The session token.
     */

    static async deleteSession(data: GetSessionRequest): Promise<void> {

        const { token } = data;

        const session = await prisma.userSession.findFirst({
            where: { token },
        });

        if (!session) {
            throw new Error("SESSION_NOT_FOUND");
        }

        await prisma.userSession.deleteMany({
            where: { token },
        });

    }

    /**
     * Registers a new user.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The registered user.
     */
    static async register(data: AuthRegisterRequest): Promise<UserSessionResponse> {

        const { email, password } = data;

        // Check if the user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new Error("USER_ALREADY_EXISTS");
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the user
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
            },
        });

        // Remove the password from the user object
        const { password: _, ...userWithoutPassword } = user;

        // Create a session
        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

        const session = await prisma.userSession.create({
            data: {
                userId: user.userId,
                token,
            },
        });

        return {
            user: userWithoutPassword,
            session,
        };
    }

    /**
     * Checks if a user has the required role.
     * @param user - The user object.
     * @param requiredRoles - The required roles.
     * @returns Whether the user has the required role.
     */
    static checkIfUserHasRole(user: OmitPasswordUserResponse, requiredRoles: string[]): boolean {
        return requiredRoles.includes(user.role);
    }
}
