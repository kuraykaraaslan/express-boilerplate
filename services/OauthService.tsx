import axiosInstance from '../libs/axios';
import jwt from 'jsonwebtoken';

export default class OauthService {

    static APP_URL = process.env.APPLICATION_HOST + ":" + process.env.APPLICATION_PORT;

    // Apple OAuth
    static APPLE_CALLBACK_PATH = "/api/v1/auth/callback/apple";
    static APPLE_AUTH_URL = 'https://appleid.apple.com/auth/authorize';
    static APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
    static APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID!;
    static APPLE_TEAM_ID = process.env.APPLE_TEAM_ID!;
    static APPLE_KEY_ID = process.env.APPLE_KEY_ID!;
    static APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY!;

    // Google OAuth
    static GOOGLE_CALLBACK_PATH = "/api/v1/auth/callback/google";
    static GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
    static GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
    static GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
    static GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;


    // Error Messages
    private static INVALID_PROVIDER = "Invalid provider";

    /*
   * Create SSO Link
   * @param provider - The provider name.
   * @returns The SSO link.
   */
    static generateAuthUrl(provider: string): string {

        if (provider === "google") {
            return this.google_generateAuthUrl();
        } else if (provider === "apple") {
            return this.apple_generateAuthUrl();
        }

        throw new Error(this.INVALID_PROVIDER);
    }

    /*
    * Create Google SSO Link
    * @returns The SSO link.
    */
    static google_generateAuthUrl(): string {


        const params = {
            client_id: process.env.GOOGLE_CLIENT_ID!,
            redirect_uri: `${this.APP_URL}${this.GOOGLE_CALLBACK_PATH}`,
            response_type: 'code',
            scope: 'profile email', // Request access to profile and email
            access_type: 'offline', // Request a refresh token
            prompt: 'consent', // Force consent screen
        };

        return `${this.GOOGLE_AUTH_URL}?${new URLSearchParams(params).toString()}`;
    }

    /*
    * Create Apple SSO Link
    * @returns The SSO link.
    */
    static apple_generateAuthUrl(): string {

        const params = {
            client_id: this.APPLE_CLIENT_ID,
            redirect_uri: `${this.APP_URL}${this.APPLE_CALLBACK_PATH}`,
            response_type: 'code',
            scope: 'profile email', // Request access to profile and email
            access_type: 'offline', // Request a refresh token
            prompt: 'consent', // Force consent screen
        };

        return `${this.APPLE_AUTH_URL}?${new URLSearchParams(params).toString()}`;
    }

    /*
    * Get Tokens from Google
    * @param code - The code from the callback.
    * @returns The access token and refresh token.
    * @throws Error if the request fails.
    */
    static async google_getTokens(code: string): Promise<{ access_token: string; refresh_token: string }> {

        const tokenResponse = await axiosInstance.post(
            this.GOOGLE_TOKEN_URL,
            new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID!,
                client_secret: process.env.GOOGLE_CLIENT_SECRET!,
                code,
                redirect_uri: `${this.APP_URL}${this.GOOGLE_CALLBACK_PATH}`,
                grant_type: 'authorization_code',
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        return {
            access_token: tokenResponse.data.access_token,
            refresh_token: tokenResponse.data.refresh_token,
        };
    }


    /*
    * Get Google User Info
    * @param accessToken - The access token.
    * @returns The user info.
    */
    static async google_getUserInfo(accessToken: string): Promise<{
        sub: string; // Google's unique ID for the user
        email: string;
        name: string;
        picture: string;
    }> {
        const userInfoResponse = await axiosInstance.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        return userInfoResponse.data;
    }


    /*
    * Generate Apple Client Secret
    * @returns The Apple client secret.
    */
    static apple_generateClientSecret(): string {


        const payload = {
            iss: this.APPLE_TEAM_ID,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
            aud: 'https://appleid.apple.com',
            sub: this.APPLE_CLIENT_ID,
        };

        return jwt.sign(payload, this.APPLE_PRIVATE_KEY, {
            algorithm: 'ES256',
            keyid: this.APPLE_KEY_ID,
        });
    }

    /*
    * Get Tokens from Apple
    * @param code - The code from the callback.
    * @returns The access token and refresh token.
    * @throws Error if the request fails
    */
    static async apple_getTokens(code: string): Promise<{ access_token: string; refresh_token: string }> {
        const clientSecret = this.apple_generateClientSecret();



        const tokenResponse = await axiosInstance.post(
            this.APPLE_TOKEN_URL,
            new URLSearchParams({
                client_id: this.APPLE_CLIENT_ID,
                client_secret: clientSecret,
                code,
                redirect_uri: `${this.APP_URL}${this.APPLE_CALLBACK_PATH}`,
                grant_type: 'authorization_code',
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        return {
            access_token: tokenResponse.data.access_token,
            refresh_token: tokenResponse.data.refresh_token,
        };
    }


    /*
    * Get Apple User Info
    * @param accessToken - The access token.
    * @returns The user info.
    * @throws Error if the request fails.
    */
    static async apple_getUserInfo(accessToken: string): Promise<{ email: string; sub: string }> {
        // Decode the ID token to get user information
        const decodedToken = jwt.decode(accessToken) as { email: string; sub: string };
        return {
            email: decodedToken.email,
            sub: decodedToken.sub, // Apple's unique ID for the user
        };
    }

}