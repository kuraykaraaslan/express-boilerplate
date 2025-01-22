import axiosInstance from '../libs/axios';
import jwt from 'jsonwebtoken';

import prisma from '../libs/prisma';
import AuthService from './AuthService';
import UserService from './UserService';
import TwilloService from './TwilloService';
import AuthResponse from '../dtos/responses/AuthResponse';
import MailService from './MailService';
import GoogleService from './SSO/GoogleService';
import AppleService from './SSO/AppleService';
import ErrorResponse from '../dtos/responses/ErrorResponse';

export default class SSOService {

    static APP_URL = process.env.APPLICATION_HOST + ":" + process.env.APPLICATION_PORT;

    // Error Messages
    private static INVALID_PROVIDER = "Invalid provider";
    private static AUTHENTICATION_FAILED = "Authentication failed";

    /**
     * Create or Update User
     * @param profile - The user profile.
     * @param accessToken - The access token.
     * @param refreshToken - The refresh token.
     * @returns AuthResponse
     */
    static async loginOrCreateUser(profile: any, accessToken: string, refreshToken: string, provider: string): Promise<AuthResponse> {

        // Get the user by email
        let user = await prisma.user.findUnique({
            where: { email: profile.email },
        });

        // Create a new user if not found
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: profile.email,
                    name: profile.name,
                    profilePicture: profile.picture,
                    password: await AuthService.hashPassword(profile.id + new Date().toISOString()),
                    userSocialAccounts: {
                        create: {
                            provider: provider,
                            providerId: profile.sub,
                            accessToken,
                            refreshToken,
                        },
                    },
                },
            });
        } else {
            // Update the user
            user = await prisma.user.update({
                where: { userId: user.userId },
                data: {
                    name: profile.name,
                    profilePicture: profile.picture,
                    userSocialAccounts: {
                        update: {
                            where: {
                                providerId: profile.sub,
                                provider: provider,
                            },
                            data: {
                                provider: provider,
                                providerId: profile.sub,
                                accessToken,
                                refreshToken,
                            },
                        },
                    },

                },
            });

            const session = await prisma.userSession.create({
                data: {
                    userId: user.userId,
                    sessionToken: AuthService.generateSessionToken(),
                    sessionExpiry: new Date(Date.now() + 3600000), // 1 hour
                    sessionAgent: "Web",
                    // No OTP needed for SSO
                    otpNeeded: false,
                },
            });

            return {
                user: UserService.omitSensitiveFields(user),
                userSession: AuthService.omitSensitiveFields(session),
            };
        }

        // Generate a session token
        const session = await prisma.userSession.create({
            data: {
                userId: user.userId,
                sessionToken: AuthService.generateSessionToken(),
                sessionExpiry: new Date(Date.now() + 3600000), // 1 hour
                sessionAgent: "Web",
                // No OTP needed for SSO
                otpNeeded: false,
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
            MailService.sendMail(user.email, "Login", `You have logged in successfully.`);
        }

        return {
            user: UserService.omitSensitiveFields(user),
            userSession: AuthService.omitSensitiveFields(session),
        };
    }

    /*
   * Create SSO Link
   * @param provider - The provider name.
   * @returns The SSO link.
   */
    static generateAuthUrl(provider: string): string {

        if (provider === "google") {
            return GoogleService.generateAuthUrl();
        } else if (provider === "apple") {
            return AppleService.generateAuthUrl();
        }
        throw new Error(this.INVALID_PROVIDER);
    }

    /*
    * Auth Callback
    * @param provider - The provider name.
    * @param code - The code.
    * @param state - The state.
    * @param scope - The scope.
    */

    static async authCallback(
        provider: string,
        code: string,
        state: string,
        scope?: string,
    ): Promise<AuthResponse> {

        if (provider === "google") {
            return this.handleGoogleCallback(code);
        } else if (provider === "apple") {
            return this.handleAppleCallback(code);
        }

        throw new Error(this.INVALID_PROVIDER);
    }

    /*
    * Handle Google Callback
    * @param code - The code.
    */
    static async handleGoogleCallback(code: string): Promise<AuthResponse> {
        try {
            // Exchange authorization code for tokens
            const { access_token, refresh_token } = await GoogleService.getTokens(code);
            // Fetch user profile
            const profile = await GoogleService.getUserInfo(access_token);
            // Create or update the user in the database
            const user = await this.loginOrCreateUser(profile, access_token, refresh_token, "google");
            return user;
        } catch (error) {
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

    /*
    * Handle Apple Callback
    * @param code - The code.
    */

    static async handleAppleCallback(code: string): Promise<AuthResponse> {
        try {
            // Exchange authorization code for tokens
            const { access_token, refresh_token } = await AppleService.getTokens(code);

            // Fetch user profile
            const profile = await AppleService.getUserInfo(access_token);

            // Create or update the user in the database
            const user = await this.loginOrCreateUser(profile, access_token, refresh_token, "apple");
            return user;
        } catch (error) {
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

}