import { UserSession } from "@prisma/client";
import { Request } from "express";
import prisma from "../../shared/libs/prisma";

// DTOs
import { GetSessionRequest } from "../dto/requests/GetSessionRequest";


// Other Services
import UserService from "../../user/services";
// Utils
import UserAgentUtil from "../utils/UserAgentUtil";
import {SafeUserSession} from "../../auth/types/SafeUserSession";
import {SafeUser} from "../../user/types/SafeUser";
import jwt from 'jsonwebtoken';
import crypto from "crypto";
import AuthMessages from "../dictionaries";

import { v4 as uuidv4 } from "uuid";

// Redis
import redis from "../../shared/libs/redis";



const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET; // Burada bir varsayılan değer belirleyebilirsiniz
const ACCESS_TOKEN_EXPIRES_MS = parseInt(process.env.ACCESS_TOKEN_EXPIRES_IN || `${1000 * 60 * 60 * 24 * 3}`); // 3 gün

const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET; // Burada bir varsayılan değer belirleyebilirsiniz
const REFRESH_TOKEN_EXPIRES_MS = parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || `${1000 * 60 * 60 * 24 * 7}`); // 30 gün

const REDIS_SESSION_EXPIRY_MS = parseInt(process.env.REDIS_SESSION_EXPIRY_MS || `${1000 * 60 * 15}`); // 15 dakika


if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  throw new Error("Missing JWT secrets in environment variables.");
}

if (isNaN(REDIS_SESSION_EXPIRY_MS)) {
  throw new Error("Invalid REDIS_SESSION_EXPIRY_MS value in environment variables.");
}

export default class UserSessionService {



  static readonly UserSessionOmitSelect = {
    userId: true,
    userSessionId: true,
  }


  /*
   * Generate Session CUID Token
    * @param userId - The user ID.
    * @param userSessionId - The session ID.
    * @param deviceFingerprint - The device fingerprint.
  * @returns A random cuid token.
  */
  private static generateAccessToken(userId: string, userSessionId: string, deviceFingerprint: string): string {

    if (!ACCESS_TOKEN_SECRET) {
      throw new Error("ACCESS_TOKEN_SECRET is not defined");
    }

    return jwt.sign(
      {
        userId: userId,
        userSessionId: userSessionId, // her session için eşsiz
        deviceFingerprint: deviceFingerprint,
      },
      ACCESS_TOKEN_SECRET,
      {
        subject: userId,                // sub: userId
        issuer: 'relatia.kuray.dev',    // iss
        audience: 'web',                // aud
        expiresIn: `${ACCESS_TOKEN_EXPIRES_MS / 1000}s`
      }
    );
  }

  /**
   * Generate Refresh Token
   * @param userId - The user ID.
   * @param userSessionId - The session ID.
   * @param deviceFingerprint - The device fingerprint.
   * @returns A random refresh token.
   */

  private static generateRefreshToken(userId: string, userSessionId: string, deviceFingerprint: string): string {
    return jwt.sign(
      {
        userId: userId,
        deviceFingerprint: deviceFingerprint,
        userSessionId: userSessionId, // her session için eşsiz
      },
      REFRESH_TOKEN_SECRET as string,
      {
        subject: userId,
        issuer: 'relatia.kuray.dev',
        audience: 'web',
        expiresIn: `${REFRESH_TOKEN_EXPIRES_MS / 1000}s`, // 30 gün
        notBefore: 5, // 5 saniye sonra geçerli
      }
    );
  }


  /**
   * Verifies a access token.
   * @param token - The access token to verify.
   * 
   * @returns The decoded token payload.
   */
  static decodeAccessToken(accessToken: string, deviceFingerprint: string): { userId: string, userSessionId: string } {

    if (!ACCESS_TOKEN_SECRET) {
      throw new Error("ACCESS_TOKEN_SECRET is not defined");
    }

    try {

      const decoded = jwt.verify(accessToken, ACCESS_TOKEN_SECRET, {
        issuer: 'relatia.kuray.dev',
        audience: 'web',
      }) as { userId: string, deviceFingerprint: string, userSessionId: string };

      if (decoded.deviceFingerprint !== deviceFingerprint) {
        throw new Error(AuthMessages.DEVICE_FINGERPRINT_NOT_MATCH);
      }

      return { userId: decoded.userId, userSessionId: decoded.userSessionId };
    } catch (error: any) {
      console.log("decodeAccessToken error", error);
      if (error.name === "TokenExpiredError") {
        throw new Error(AuthMessages.TOKEN_EXPIRED);
      }
      throw new Error(AuthMessages.INVALID_TOKEN);
    }
  }


  /**
   * Verifies a refresh token.
   * @param token - The refresh token to verify.
   * @returns The decoded token payload.
   */
static decodeRefreshToken(refreshToken: string): { userId: string , userSessionId: string } {
  if (!REFRESH_TOKEN_SECRET) {
    throw new Error("REFRESH_TOKEN_SECRET is not defined");
  }

  try {
    console.log("🔑 decoding refresh token:", refreshToken);
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, {
      issuer: 'relatia.kuray.dev',
      audience: 'web',
    }) as { userId: string , userSessionId: string };

    return decoded;

  } catch (error: any) {
    console.error("❌ JWT verify failed", error);
    if (error.name === "TokenExpiredError") {
      throw new Error(AuthMessages.TOKEN_EXPIRED);
    }
    throw new Error(AuthMessages.INVALID_TOKEN);
  }
}


  /**
   * Hashes a token using SHA-256.
   * @param token - The access token to verify.
   * @returns The decoded token payload.
   */
  static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }


  /**
   * Generates a device fingerprint based on the request headers.
   * @param request - The HTTP request object.
   * @returns A promise that resolves to the device fingerprint.
   */
  static async generateDeviceFingerprint(request: Request): Promise<string> {
    const ip = request.headers["x-forwarded-for"] || request.socket.remoteAddress || "";
    const userAgent = request.headers["user-agent"] || "";
    const acceptLanguage = request.headers["accept-language"] || "";

    const rawFingerprint = `${ip}|${userAgent}|${acceptLanguage}`;
    return crypto.createHash("sha256").update(rawFingerprint).digest("hex");
  }
  
  /**
   * Set Redis key
   * @param hashedAccessToken - The hashed access token.
   * @param session - SafeUserSession
   * @returns A promise that resolves when the key is set.
   */
  static async setRedisUserSession(hashedAccessToken: string, session: SafeUserSession): Promise<void> {
    const redisKey = `user-session:${hashedAccessToken}`;
    const redisValue = JSON.stringify(session);
    await redis.set(redisKey, redisValue, "EX", REDIS_SESSION_EXPIRY_MS);
  }

  /**
   * Get Redis key
   * @param hashedAccessToken - The hashed access token.
   * @returns A promise that resolves to the session.
   */
  static async getRedisUserSession(hashedAccessToken: string): Promise<SafeUserSession | null> {
    const redisKey = `user-session:${hashedAccessToken}`;
    const redisValue = await redis.get(redisKey);
    if (!redisValue) return null;
    const session = JSON.parse(redisValue) as SafeUserSession;
    return session;
  }

  /**
   * Deletes a Redis key.
   * @param hashedAccessToken - The hashed access token.
   * @returns A promise that resolves when the key is deleted.
   */
  static async deleteRedisUserSession(hashedAccessToken: string): Promise<void> {
    const redisKey = `user-session:${hashedAccessToken}`;
    await redis.del(redisKey);
  }


  /**
   * Creates a new user session.
   * @param userId - The user ID.
   * @returns The created session.
   */
  static async createSession(user: SafeUser, request: Request, otpIgnore: boolean = false): Promise<
    {
      userSession: SafeUserSession,
      otpVerifyNeeded: boolean,
      rawAccessToken: string,
      rawRefreshToken: string
    }> {

    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);

    const userAgentData = await UserAgentUtil.parseRequest(request);

    // Generate a random session ID
    const userSessionId = uuidv4();

    const rawAccessToken = UserSessionService.generateAccessToken(user.userId, userSessionId, deviceFingerprint);
    const hashedAccessToken = UserSessionService.hashToken(rawAccessToken);



    const rawRefreshToken = UserSessionService.generateRefreshToken(user.userId, userSessionId, deviceFingerprint);
    const hashedRefreshToken = UserSessionService.hashToken(rawRefreshToken);

    const otpVerifyNeeded = !otpIgnore && user.otpMethods && user.otpMethods.length > 0;

    const userSession = await prisma.userSession.create({
      data: {
        userSessionId: userSessionId,
        userId: user.userId,
        accessToken: hashedAccessToken,
        refreshToken: hashedRefreshToken,
        sessionExpiry: new Date(Date.now() + ACCESS_TOKEN_EXPIRES_MS),
        deviceFingerprint: deviceFingerprint,
        otpVerifyNeeded,
        ip: userAgentData.ip || "Unknown",
        os: userAgentData.os || "Unknown",
        device: userAgentData.device || "Unknown",
        browser: userAgentData.browser || "Unknown",
        city: userAgentData.city || "Unknown",
        state: userAgentData.state || "Unknown",
        country: userAgentData.country || "Unknown",
      },
    });

    // Set the session in Redis
    await UserSessionService.setRedisUserSession(hashedAccessToken, UserSessionService.omitSensitiveFields(userSession));


    return {
      userSession: UserSessionService.omitSensitiveFields(userSession),
      otpVerifyNeeded: userSession.otpVerifyNeeded,
      rawAccessToken,
      rawRefreshToken,
    };

  }

  /**
   * Gets a user session by token.
   * @param accessToken - The session token.
   * @returns The user session.
   */
  static async getSessionDangerously(data: GetSessionRequest, request: Request): Promise<{ user: SafeUser, userSession: SafeUserSession }> {

    console.log("getSessionDangerously", data);
    // Check if the access token is provided TODO: Validate the token format
    if (!data.accessToken) {
      console.log("getSessionDangerously", "No access token provided");
      throw new Error(AuthMessages.INVALID_TOKEN);
    }

    // Verify the access token
    const userAgentData = await UserAgentUtil.parseRequest(request);
    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);
    // Check if the device fingerprint is provided
    const hashedAccessToken = UserSessionService.hashToken(data.accessToken);

    console.log("hashedAccessToken", hashedAccessToken);
    console.log("deviceFingerprint", deviceFingerprint);
    console.log("userAgentData", userAgentData);

    const { userId, userSessionId } = await UserSessionService.decodeAccessToken(data.accessToken, deviceFingerprint);

    const userSession = await prisma.userSession.findFirst({
      where: {
        userSessionId: userSessionId,
        accessToken: hashedAccessToken,
        deviceFingerprint: deviceFingerprint,
        sessionExpiry: {
          gte: new Date(), // Check if the session is not expired   
        },
      },
    })

    console.log("userSession ", userSession);

    if (!userSession || userSession.userId !== userId) {
      throw new Error(AuthMessages.SESSION_NOT_FOUND);
    }

    // Otp needed kontrolü
    if (userSession.otpVerifyNeeded) {
      throw new Error(AuthMessages.OTP_NEEDED);
    }

    // Check if the connection is from the same device
    if (userSession.deviceFingerprint !== deviceFingerprint) {
      throw new Error(AuthMessages.DEVICE_FINGERPRINT_NOT_MATCH);
    }

    // Check if the connection is from the same Country
    if (userSession.country !== userAgentData.country) {
      throw new Error(AuthMessages.DEVICE_FINGERPRINT_NOT_MATCH);
    }

    // Check if the session 
    const user = await prisma.user.findUnique({
      where: { userId: userSession.userId },
    })

    if (!user) {
      throw new Error(AuthMessages.USER_NOT_FOUND);
    }

    return {
      user: UserService.omitSensitiveFields(user),
      userSession: UserSessionService.omitSensitiveFields(userSession),
    };
  }

  /**
   * Omits sensitive fields from the user session.
   * @param session - The user session.
   * @returns The user session without sensitive fields.
   */
  static async getSession(data: GetSessionRequest, request: Request<any>): Promise<{ userSession: SafeUserSession }> {

    // Redis first
    const hashedAccessToken = UserSessionService.hashToken(data.accessToken);
    const redisSession = await UserSessionService.getRedisUserSession(hashedAccessToken);

    if (redisSession) {
      return {
        userSession: redisSession,
      };
    }

    // Get the session using the provided access token
    const {userSession } = await UserSessionService.getSessionDangerously(data, request);

    // Check if the session is expired
    return {
      userSession: userSession,
    };
  }

  static omitSensitiveFields(session: UserSession): SafeUserSession {
    return {
      userSessionId: session.userSessionId,
      userId: session.userId,
      otpVerifyNeeded: session.otpVerifyNeeded,
      sessionExpiry: session.sessionExpiry,
    };
  }


  public static async refreshAccessToken(currentRefreshToken: string) {

    console.log("refreshAccessToken", currentRefreshToken);

    // Decode the refresh token
    const { userId, userSessionId } = await UserSessionService.decodeRefreshToken(currentRefreshToken);

    const hashedRefreshToken = UserSessionService.hashToken(currentRefreshToken);

    const userSession = await prisma.userSession.findFirst({
      where: {
        userSessionId: userSessionId,
        refreshToken: hashedRefreshToken,
        userId: userId,
        sessionExpiry: {
          gte: new Date(), // Check if the session is not expired
        },
      },
    });

    if (!userSession) throw new Error(AuthMessages.SESSION_NOT_FOUND);

    // Otp needed kontrolü
    if (userSession.otpVerifyNeeded) {
      throw new Error(AuthMessages.OTP_NEEDED);
    }

    // 🔁 Refresh token reuse kontrolü
    if (userSession.refreshToken !== hashedRefreshToken) {

      // Reuse detected: Force logout all logged-in sessions of the user
      await prisma.userSession.deleteMany({
        where: {
          userId: userSession.userId,
        },
      });

      throw new Error(AuthMessages.REFRESH_TOKEN_REUSED); // ya da 401
    }

    // 🔄 Token rotation
    const newAccessToken = this.generateAccessToken(userSession.userId, userSession.userSessionId, userSession.deviceFingerprint!);
    const newRefreshToken = this.generateRefreshToken(userSession.userId, userSession.userSessionId, userSession.deviceFingerprint!);
    const newRefreshTokenHash = this.hashToken(newRefreshToken);

    const updatedSession = await prisma.userSession.update({
      where: { userSessionId: userSession.userSessionId },
      data: {
        accessToken: this.hashToken(newAccessToken),
        refreshToken: newRefreshTokenHash,
        sessionExpiry: new Date(Date.now() + ACCESS_TOKEN_EXPIRES_MS),
      }
    });

    // Set the new session in Redis
    await UserSessionService.setRedisUserSession(this.hashToken(newAccessToken), UserSessionService.omitSensitiveFields(updatedSession));

    return {
      userSession: this.omitSensitiveFields(updatedSession),
      rawAccessToken: newAccessToken,
      rawRefreshToken: newRefreshToken,
    };
  }



  /**
   * Destroy all other sessions of the user.
   * 
   * @param userSession - The current user session.
   * @returns A promise that resolves when the sessions are destroyed.
   */
  static async destroyOtherSessions(userSession: SafeUserSession): Promise<void> {
    // Delete all sessions except the current one
    await prisma.userSession.deleteMany({
      where: {
        userId: userSession.userId,
        userSessionId: {
          not: userSession.userSessionId,
        },
      },
    });
  }



  /**
   * Deletes a user session.
   * @param data - The user session data to delete.
   */

  static async deleteSession(data: SafeUserSession): Promise<void> {

    // Get session by ID
    const session = await prisma.userSession.findUnique({
      where: { userSessionId: data.userSessionId },
    });

    if (!session) {
      throw new Error(AuthMessages.SESSION_NOT_FOUND);
    }

    // Delete the session from Redis
    const hashedAccessToken = UserSessionService.hashToken(session.accessToken);
    await UserSessionService.deleteRedisUserSession(hashedAccessToken);
    // Delete the session from the database
    await prisma.userSession.deleteMany({
      where: { userSessionId: data.userSessionId },
    });

  }

  /**
   * Deletes all user sessions of a user.
   * @param userId - The user ID.
   * @returns A promise that resolves when the sessions are deleted.
   */
  static async deleteAllUserSessions(userId: string): Promise<void> {

    // Delete all sessions of the user
    await prisma.userSession.deleteMany({
      where: { userId: userId },
    });

  }

}