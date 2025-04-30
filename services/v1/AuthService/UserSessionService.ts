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


const ACCESS_TOKEN_SECRET: jwt.Secret = process.env.ACCESS_TOKEN_SECRET || 'your-default-secret'; // Burada bir varsayılan değer belirleyebilirsiniz
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h'; // veya '1h' gibi

const REFRESH_TOKEN_SECRET: jwt.Secret = process.env.REFRESH_TOKEN_SECRET! || 'your-default-secret'; // Burada bir varsayılan değer belirleyebilirsiniz
const REFRESH_TOKEN_EXPIRES_IN: string | number = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'; // veya '7d' gibi

const SESSION_EXPIRY_MS = parseInt(process.env.SESSION_EXPIRY_MS || `${1000 * 60 * 60 * 24 * 7}`);

export default class UserSessionService {

  static readonly UserSessionOmitSelect = {
    userId: true,
    sessionId: true,
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
   * Verifies a access token.
   * @param token - The access token to verify.
   * @returns The decoded token payload.
   */
  static async verifyAccessToken(token: string): Promise<void> {
    //TODO: Implement token verification logic
  }

  /**
   * Verifies a refresh token.
   * @param token - The refresh token to verify.
   * @returns The decoded token payload.
   */
  static verifyRefreshToken(token: string): any {
    //TODO: Implement token verification logic
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

    const userAgentData = await UserAgentUtil.parseRequest(request);

    const rawAccessToken = UserSessionService.generateAccessToken(user.userId);
    const hashedAccessToken = UserSessionService.hashToken(rawAccessToken);

    const rawRefreshToken = UserSessionService.generateRefreshToken(user.userId);
    const hashedRefreshToken = UserSessionService.hashToken(rawRefreshToken);

    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);

    const otpNeeded = otpEnforce || user.otpEnabled;

    const userSession = await prisma.userSession.create({
      data: {
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
    await UserSessionService.verifyAccessToken(data.accessToken);

    // Check if the device fingerprint is provided
    const hashedAccessToken = UserSessionService.hashToken(data.accessToken);
    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);

    console.log("REQUEST DEVICE FINGERPRINT: ", deviceFingerprint);

    const userSession = await prisma.userSession.findUnique({
      where: {
        accessToken: hashedAccessToken,
        //deviceFingerprint: deviceFingerprint,
        sessionExpiry: {
          gte: new Date(), // Check if the session is not expired   
        },
      },
    })
    console.log("SESSIONID: ", userSession?.sessionId);


    if (!userSession) {
      throw new Error(AuthErrors.SESSION_NOT_FOUND);
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


  public static async refreshAccessToken({ currentSession, currentRefreshToken }: { currentSession: UserSession, currentRefreshToken: string }): Promise<{ userSession: UserSessionOmit, rawAccessToken: string, rawRefreshToken: string }> {
    
    // Verify the refresh token
    await UserSessionService.verifyRefreshToken(currentRefreshToken);
    
    // Check if the refresh token is valid
    const hashedCurrentRefreshToken = UserSessionService.hashToken(currentRefreshToken);
    if (currentSession.refreshToken !== hashedCurrentRefreshToken) {
      throw new Error(AuthErrors.INVALID_REFRESH_TOKEN);
    }

    // Check if the session is expired
    const now = new Date();
    if (currentSession.sessionExpiry < now) {
      throw new Error(AuthErrors.SESSION_NOT_FOUND);
    }

    // Generate new access and refresh tokens
    const rawAccessToken = UserSessionService.generateAccessToken(currentSession.userId);
    const hashedAccessToken = UserSessionService.hashToken(rawAccessToken);
    const rawRefreshToken = UserSessionService.generateRefreshToken(currentSession.userId);
    const hashedRefreshToken = UserSessionService.hashToken(rawRefreshToken);
    // Update the session with the new tokens
    const updatedSession = await prisma.userSession.update({
      where: { sessionId: currentSession.sessionId },
      data: {
        accessToken: hashedAccessToken,
        refreshToken: hashedRefreshToken,
        sessionExpiry: new Date(Date.now() + SESSION_EXPIRY_MS),
      },
    });
    // Return the updated session and tokens
    return {
      userSession: UserSessionService.omitSensitiveFields(updatedSession),
      rawAccessToken,
      rawRefreshToken,
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
