import axiosInstance from '../../libs/axios';
import jwt from 'jsonwebtoken';

import prisma from '../../libs/prisma';
import AuthService from '../AuthService';
import UserService from '../UserService';
import TwilloService from '../TwilloService';
import AuthResponse from '../../dtos/responses/AuthResponse';
import MailService from '../MailService';
import GoogleService from './GoogleService';
import AppleService from './AppleService';
import FacebookService from './FacebookService';
import GithubService from './GithubService';
import LinkedInService from './LinkedInService';
import MicrosoftService from './MicrosoftService';
import ErrorResponse from '../../dtos/responses/ErrorResponse';
import TwitterService from './TwitterService';

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
        if (!profile.email) {
            throw new Error('Email is required');
        }

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
                            providerId: profile.sub || profile.id,
                            accessToken,
                            refreshToken,
                        },
                    },
                },
            });

            // Send welcome email
            MailService.sendWelcomeEmail(user.email, user.name);

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
                                providerId: profile.sub || profile.id,
                                provider: provider,
                            },
                            data: {
                                provider: provider,
                                providerId: profile.sub || profile.id,
                                accessToken,
                                refreshToken,
                            },
                        },
                    },
                },
            });

            // Send new login email
            MailService.sendNewLoginEmail(user.email, user.name);
        }

        // Create a session
        const session = await AuthService.createSession(user, false); // Create a new session without otp verification for SSO login

        return {
            user: UserService.omitSensitiveFields(user),
            userSession: AuthService.omitSensitiveFields(session),
        };
    }

    /*
     * Generate SSO Link
     * @param provider - The provider name.
     * @returns The SSO link.
     */
    static generateAuthUrl(provider: string): string {
        switch (provider) {
            case 'google':
                return GoogleService.generateAuthUrl();
            case 'apple':
                return AppleService.generateAuthUrl();
            case 'facebook':
                return FacebookService.generateAuthUrl();
            case 'github':
                return GithubService.generateAuthUrl();
            case 'linkedin':
                return LinkedInService.generateAuthUrl();
            case 'microsoft':
                return MicrosoftService.generateAuthUrl();
            case 'twitter':
                return TwitterService.generateAuthUrl();
            default:
                throw new Error(this.INVALID_PROVIDER);
        }
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
        if (!provider || !code || !state) {
            throw new Error('Missing required parameters');
        }

        switch (provider) {
            case 'google':
                return this.handleGoogleCallback(code);
            case 'apple':
                return this.handleAppleCallback(code);
            case 'facebook':
                return this.handleFacebookCallback(code);
            case 'github':
                return this.handleGithubCallback(code);
            case 'linkedin':
                return this.handleLinkedInCallback(code);
            case 'microsoft':
                return this.handleMicrosoftCallback(code);
            default:
                throw new Error(this.INVALID_PROVIDER);
        }
    }

    /*
     * Handle Google Callback
     * @param code - The code.
     */
    static async handleGoogleCallback(code: string): Promise<AuthResponse> {
        try {
            const { access_token, refresh_token } = await GoogleService.getTokens(code);
            const profile = await GoogleService.getUserInfo(access_token);
            return this.loginOrCreateUser(profile, access_token, refresh_token, "google");
        } catch (error) {
            console.error('Google authentication failed:', error);
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

    /*
     * Handle Apple Callback
     * @param code - The code.
     */
    static async handleAppleCallback(code: string): Promise<AuthResponse> {
        try {
            const { access_token, refresh_token } = await AppleService.getTokens(code);
            const profile = await AppleService.getUserInfo(access_token);
            return this.loginOrCreateUser(profile, access_token, refresh_token, "apple");
        } catch (error) {
            console.error('Apple authentication failed:', error);
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

    /*
     * Handle Facebook Callback
     * @param code - The code.
     */
    static async handleFacebookCallback(code: string): Promise<AuthResponse> {
        try {
            const { access_token } = await FacebookService.getTokens(code);
            const profile = await FacebookService.getUserInfo(access_token);
            return this.loginOrCreateUser(profile, access_token, '', "facebook");
        } catch (error) {
            console.error('Facebook authentication failed:', error);
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

    /*
     * Handle GitHub Callback
     * @param code - The code.
     */
    static async handleGithubCallback(code: string): Promise<AuthResponse> {
        try {
            const { access_token } = await GithubService.getTokens(code);
            const profile = await GithubService.getUserInfo(access_token);
            return this.loginOrCreateUser(profile, access_token, '', "github");
        } catch (error) {
            console.error('GitHub authentication failed:', error);
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

    /*
     * Handle LinkedIn Callback
     * @param code - The code.
     */
    static async handleLinkedInCallback(code: string): Promise<AuthResponse> {
        try {
            const { access_token } = await LinkedInService.getTokens(code);
            const profile = await LinkedInService.getUserInfo(access_token);
            return this.loginOrCreateUser(profile, access_token, '', "linkedin");
        } catch (error) {
            console.error('LinkedIn authentication failed:', error);
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }

    /*
     * Handle Microsoft Callback
     * @param code - The code.
     */
    static async handleMicrosoftCallback(code: string): Promise<AuthResponse> {
        try {
            const { access_token, refresh_token } = await MicrosoftService.getTokens(code);
            const profile = await MicrosoftService.getUserInfo(access_token);
            return this.loginOrCreateUser(profile, access_token, refresh_token, "microsoft");
        } catch (error) {
            console.error('Microsoft authentication failed:', error);
            throw new Error(this.AUTHENTICATION_FAILED);
        }
    }
}