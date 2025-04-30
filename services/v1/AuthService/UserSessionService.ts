import { UserSession } from "@prisma/client";
import { Request } from "express";
import prisma from "../../../libs/prisma";

// DTOs
import GetSessionRequest from "../../../dtos/requests/auth/GetSessionRequest";


// Other Services
import UserService from "../UserService";
// Utils
import UserAgentUtil from "../../../utils/UserAgentUtil";
import UserSessionOmit from "../../../types/UserSessionOmit";
import UserOmit from "../../../types/UserOmit";
import jwt from 'jsonwebtoken';
import crypto from "crypto";
import AuthErrors from "../../../errors/AuthErrors";

import { v4 as uuidv4 } from "uuid";


const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET; // Burada bir varsayılan değer belirleyebilirsiniz
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h'; // veya '1h' gibi

const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET; // Burada bir varsayılan değer belirleyebilirsiniz
const REFRESH_TOKEN_EXPIRES_IN: string | number = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'; // veya '7d' gibi

const SESSION_EXPIRY_MS = parseInt(process.env.SESSION_EXPIRY_MS || `${1000 * 60 * 60 * 24 * 7}`);


if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
  throw new Error("Missing JWT secrets in environment variables.");
}

if (isNaN(SESSION_EXPIRY_MS)) {
  throw new Error("Invalid SESSION_EXPIRY_MS value in environment variables.");
}

export default class UserSessionService {



  static readonly UserSessionOmitSelect = {
    userId: true,
    sessionId: true,
  }


  /*
   * Generate Session CUID Token
    * @param userId - The user ID.
    * @param sessionId - The session ID.
    * @param deviceFingerprint - The device fingerprint.
  * @returns A random cuid token.
  */
  private static generateAccessToken(userId: string, sessionId: string, deviceFingerprint: string): string {

    if (!ACCESS_TOKEN_SECRET) {
      throw new Error("ACCESS_TOKEN_SECRET is not defined");
    }

    // @ts-ignore
    return jwt.sign(
      {
        userId: userId,
        sessionId: sessionId, // her session için eşsiz
        deviceFingerprint: deviceFingerprint,
      },
      ACCESS_TOKEN_SECRET,
      {
        subject: userId,                // sub: userId
        issuer: 'relatia.kuray.dev',    // iss
        audience: 'web',                // aud
        expiresIn: ACCESS_TOKEN_EXPIRES_IN, // exp
      }
    );
  }

  /**
   * Generate Refresh Token
   * @param userId - The user ID.
   * @param sessionId - The session ID.
   * @param deviceFingerprint - The device fingerprint.
   * @returns A random refresh token.
   */

  private static generateRefreshToken(userId: string, sessionId: string, deviceFingerprint: string): string {
    // @ts-ignore
    return jwt.sign(
      {
        userId: userId,
        deviceFingerprint: deviceFingerprint,
        sessionId: sessionId, // her session için eşsiz
      },
      REFRESH_TOKEN_SECRET as string,
      {
        subject: userId,
        issuer: 'relatia.kuray.dev',
        audience: 'web',
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
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
  static async verifyAccessToken(token: string, deviceFingerprint: string): Promise<{ userId: string }> {

    if (!ACCESS_TOKEN_SECRET) {
      throw new Error("ACCESS_TOKEN_SECRET is not defined");
    }

    try {

      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
        issuer: 'relatia.kuray.dev',
        audience: 'web',
      }) as { userId: string, deviceFingerprint: string, sessionId: string };

      if (decoded.deviceFingerprint !== deviceFingerprint) {
        throw new Error(AuthErrors.INVALID_TOKEN);
      }

      return { userId: decoded.userId };
    } catch (error: any) {
      if (error.name === "TokenExpiredError") {
        throw new Error(AuthErrors.TOKEN_EXPIRED);
      }
      throw new Error(AuthErrors.INVALID_TOKEN);
    }
  }


  /**
   * Verifies a refresh token.
   * @param token - The refresh token to verify.
   * @returns The decoded token payload.
   */
  static verifyRefreshToken(token: string): any {

    if (!REFRESH_TOKEN_SECRET) {
      throw new Error("REFRESH_TOKEN_SECRET is not defined");
    }

    try {
      const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET, {
        issuer: 'relatia.kuray.dev',
        audience: 'web',
      }) as { userId: string };

      return decoded;
    } catch (error: any) {
      if (error.name === "TokenExpiredError") {
        throw new Error(AuthErrors.TOKEN_EXPIRED);
      }
      throw new Error(AuthErrors.INVALID_TOKEN);
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
   * Creates a new user session.
   * @param userId - The user ID.
   * @returns The created session.
   */
  static async createSession(user: UserOmit, request: Request<any>, otpEnforce: boolean = false): Promise<
    {
      userSession: UserSessionOmit,
      otpNeeded: boolean,
      rawAccessToken: string,
      rawRefreshToken: string
    }> {

    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);

    const userAgentData = await UserAgentUtil.parseRequest(request);

    // Generate a random session ID
    const sessionId = uuidv4();

    const rawAccessToken = UserSessionService.generateAccessToken(user.userId, sessionId, deviceFingerprint);
    const hashedAccessToken = UserSessionService.hashToken(rawAccessToken);



    const rawRefreshToken = UserSessionService.generateRefreshToken(user.userId, sessionId, deviceFingerprint);
    const hashedRefreshToken = UserSessionService.hashToken(rawRefreshToken);


    const otpNeeded = otpEnforce || user.otpEnabled;

    const userSession = await prisma.userSession.create({
      data: {
        sessionId: sessionId,
        userId: user.userId,
        accessToken: hashedAccessToken,
        refreshToken: hashedRefreshToken,
        sessionExpiry: new Date(Date.now() + SESSION_EXPIRY_MS),
        sessionAgent: "Web",
        deviceFingerprint: deviceFingerprint,
        otpNeeded,
        ip: userAgentData.ip || "Unknown",
        os: userAgentData.os || "Unknown",
        device: userAgentData.device || "Unknown",
        browser: userAgentData.browser || "Unknown",
        city: userAgentData.city || "Unknown",
        state: userAgentData.state || "Unknown",
        country: userAgentData.country || "Unknown",
      },
    });


    return {
      userSession: UserSessionService.omitSensitiveFields(userSession),
      otpNeeded: userSession.otpNeeded,
      rawAccessToken,
      rawRefreshToken,
    };

  }

  /**
   * Gets a user session by token.
   * @param accessToken - The session token.
   * @returns The user session.
   */
  static async getSessionDangerously(data: GetSessionRequest, request: Request<any>): Promise<{ user: UserOmit, userSession: UserSessionOmit }> {

    // Verify the access token
    const userAgentData = await UserAgentUtil.parseRequest(request);
    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);

    const { userId } = await UserSessionService.verifyAccessToken(data.accessToken, deviceFingerprint);

    // Check if the device fingerprint is provided
    const hashedAccessToken = UserSessionService.hashToken(data.accessToken);

    const userSession = await prisma.userSession.findFirst({
      where: {
        accessToken: hashedAccessToken,
        deviceFingerprint: deviceFingerprint,
        sessionExpiry: {
          gte: new Date(), // Check if the session is not expired   
        },

      },
    })

    if (!userSession || userSession.userId !== userId) {
      throw new Error(AuthErrors.SESSION_NOT_FOUND);
    }

    // Otp needed kontrolü
    if (userSession.otpNeeded) {
      throw new Error(AuthErrors.OTP_NEEDED);
    }

    // Check if the connection is from the same device
    if (userSession.deviceFingerprint !== deviceFingerprint) {
      throw new Error(AuthErrors.DEVICE_FINGERPRINT_NOT_MATCH);
    }

    // Check if the connection is from the same Country
    if (userSession.country !== userAgentData.country) {
      throw new Error(AuthErrors.DEVICE_FINGERPRINT_NOT_MATCH);
    }

    // Check if the session 
    const user = await prisma.user.findUnique({
      where: { userId: userSession.userId },
    })

    if (!user) {
      throw new Error(AuthErrors.USER_NOT_FOUND);
    }

    return {
      user: UserService.omitSensitiveFields(user),
      userSession: userSession,
    };
  }

  /**
   * Omits sensitive fields from the user session.
   * @param session - The user session.
   * @returns The user session without sensitive fields.
   */
  static async getSession(data: GetSessionRequest, request: Request<any>): Promise<{ user: UserOmit, userSession: UserSessionOmit }> {
    // Get the session using the provided access token
    const { user, userSession } = await UserSessionService.getSessionDangerously(data, request);

    // Check if the session is expired
    return {
      user: user,
      userSession: userSession,
    };
  }

  static omitSensitiveFields(session: UserSession): UserSessionOmit {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      otpNeeded: session.otpNeeded,
      tenantUserId: session.tenantUserId,
      tenantId: session.tenantId,
      sessionExpiry: session.sessionExpiry,
    };
  }


  public static async refreshAccessToken( currentRefreshToken : string ) {

    // Decode the refresh token
    const { userId } = await UserSessionService.verifyRefreshToken(currentRefreshToken);

    const userSession = await prisma.userSession.findFirst({
      where: { 
        refreshToken: UserSessionService.hashToken(currentRefreshToken) ,
        userId: userId,
        sessionExpiry: {
          gte: new Date(), // Check if the session is not expired
        },
      },
    });


    if (!userSession) throw new Error(AuthErrors.SESSION_NOT_FOUND);


    // Otp needed kontrolü
    if (userSession.otpNeeded) {
      throw new Error(AuthErrors.OTP_NEEDED);
    }

    const hashed = this.hashToken(currentRefreshToken);

    // 🔁 Refresh token reuse kontrolü
    if (userSession.refreshToken !== hashed) {
      // Reuse detected: tüm oturumları sil
      await prisma.userSession.deleteMany({
        where: {
          userId: userSession.userId,
        },
      });

      throw new Error(AuthErrors.REFRESH_TOKEN_REUSED); // ya da 401
    }

    // 🔄 Token rotation
    const newAccessToken = this.generateAccessToken(userSession.userId, userSession.sessionId, userSession.deviceFingerprint!);
    const newRefreshToken = this.generateRefreshToken(userSession.userId, userSession.sessionId, userSession.deviceFingerprint!);
    const newRefreshTokenHash = this.hashToken(newRefreshToken);

    const updatedSession = await prisma.userSession.update({
      where: { sessionId: userSession.sessionId },
      data: {
        accessToken: this.hashToken(newAccessToken),
        refreshToken: newRefreshTokenHash,
        sessionExpiry: new Date(Date.now() + SESSION_EXPIRY_MS),
      }
    });

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
  static async destroyOtherSessions(userSession: UserSessionOmit): Promise<void> {
    // Delete all sessions except the current one
    await prisma.userSession.deleteMany({
      where: {
        userId: userSession.userId,
        sessionId: {
          not: userSession.sessionId,
        },
      },
    });
  }



  /**
   * Deletes a user session.
   * @param data - The user session data to delete.
   */

  static async deleteSession(data: UserSessionOmit): Promise<void> {

    await prisma.userSession.deleteMany({
      where: { sessionId: data.sessionId },
    });

  }
}
