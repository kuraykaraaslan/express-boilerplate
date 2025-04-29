// services/auth/TokenService.ts

import jwt from "jsonwebtoken";
import cuid from "cuid";

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "1h";

const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";

export default class TokenService {

    /*
     * Generate Session CUID Token
    * @returns A random cuid token.
    */
    static generateAccessToken(userId: string): string {
        // @ts-ignore
        return jwt.sign(
            {
                sub: userId,
                jti: cuid(), // benzersiz token ID
                iss: "auth-service",
            },
            ACCESS_TOKEN_SECRET,
            { expiresIn: '1h' }
        );
    }

    /**
     * Generate Refresh Token
     * @returns A random refresh token.
     */
    static generateRefreshToken(userId: string): string {
        // @ts-ignore
        return jwt.sign({
            sub: userId,
            jti: cuid(), // benzersiz token ID
            iss: "auth-service",
        },
            REFRESH_TOKEN_SECRET,
            { expiresIn: '7d' }
        );
    }

    /**
     * Verify Access Token
     * @param token - The access token to verify.
     * @returns The decoded token payload.
     */
    static verifyAccessToken(token: string): { sub: string } {
        return jwt.verify(token, ACCESS_TOKEN_SECRET) as { sub: string };
    }

    /**
     * Verify Refresh Token
     * @param token - The refresh token to verify.
     * @returns The decoded token payload.
     */
    static verifyRefreshToken(token: string): { sub: string } {
        return jwt.verify(token, REFRESH_TOKEN_SECRET) as { sub: string };
    }
}
