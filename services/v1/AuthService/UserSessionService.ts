import { UserSession } from "@prisma/client";
import { Request } from "express";
import prisma from "../../../libs/prisma";

// DTOs
import LoginResponse from "../../../dtos/responses/auth/LoginResponse";
import GetSessionRequest from "../../../dtos/requests/auth/GetSessionRequest";


// Other Services
import UserService from "../UserService";
// Utils
import UserAgentUtil from "../../../utils/UserAgentUtil";
import UserSessionOmit from "../../../types/UserSessionOmit";
import UserOmit from "../../../types/UserOmit";
import jwt from 'jsonwebtoken';
import TenantService from "../TenantService";
import TenantUserService from "../TenantService/TenantUserService";
import crypto from "crypto";
import AuthErrors from "../../../errors/AuthErrors";


const ACCESS_TOKEN_SECRET: jwt.Secret = process.env.ACCESS_TOKEN_SECRET || 'your-default-secret'; // Burada bir varsayılan değer belirleyebilirsiniz
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h'; // veya '1h' gibi

const REFRESH_TOKEN_SECRET: jwt.Secret = process.env.REFRESH_TOKEN_SECRET! || 'your-default-secret'; // Burada bir varsayılan değer belirleyebilirsiniz
const REFRESH_TOKEN_EXPIRES_IN: string | number = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'; // veya '7d' gibi

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
  static async createSession(user: UserOmit, request: Request<any>, otpConsired: boolean = false): Promise<
    {
      userSession: UserSessionOmit,
      otpNeeded: boolean,
      rawAccessToken: string,
      rawRefreshToken: string
    }> {

    const userAgentData = await UserAgentUtil.parseRequest(request);

    console.log("User Agent Data: ", userAgentData);

    const rawAccessToken = UserSessionService.generateAccessToken(user.userId);
    const hashedAccessToken = UserSessionService.hashToken(rawAccessToken);

    const rawRefreshToken = UserSessionService.generateRefreshToken(user.userId);
    const hashedRefreshToken = UserSessionService.hashToken(rawRefreshToken);

    const otpNeeded = otpConsired ? user.otpEnabled : false;

    const userSession = await prisma.userSession.create({
      data: {
        userId: user.userId,
        accessToken: hashedAccessToken,
        refreshToken: hashedRefreshToken,
        sessionExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        sessionAgent: "Web",
        otpNeeded: otpConsired ? user.otpEnabled : false,
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
      otpNeeded,
      rawAccessToken,
      rawRefreshToken,
    };

  }

  /**
   * Gets a user session by token.
   * @param accessToken - The session token.
   * @returns The user session.
   */
  static async getSessionDangerously(data: GetSessionRequest, deviceFingerprint: string): Promise<{ user: UserOmit, userSession: UserSession }> {

    const hashedAccessToken = UserSessionService.hashToken(data.accessToken);

    const userSession = await prisma.userSession.findUnique({
      where: { accessToken: hashedAccessToken },
    })

    console.log("Session: ", userSession);

    if (!userSession) {
      throw new Error(AuthErrors.SESSION_NOT_FOUND);
    }

    const user = await prisma.user.findUniqueOrThrow({
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
  static async getSession(data: GetSessionRequest, deviceFingerprint: string): Promise<{ user: UserOmit, userSession: UserSessionOmit }> {
    // Get the session using the provided access token
    const { user, userSession } = await UserSessionService.getSessionDangerously(data, deviceFingerprint);
    return {
      user: user,
      userSession: UserSessionService.omitSensitiveFields(userSession),
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


  public static async refreshAccessToken(accessToken: string): Promise<UserSessionOmit | null> {
    const session = await prisma.userSession.findFirst({
      where: {
        accessToken,
        sessionExpiry: {
          gt: new Date(),
        },
      },
    });

    if (!session) {
      throw new Error(AuthErrors.SESSION_NOT_FOUND);
    }

    const newRefreshToken = UserSessionService.generateRefreshToken(session.userId);
    const hashedRefreshToken = UserSessionService.hashToken(newRefreshToken);

    const newAccessToken = UserSessionService.generateAccessToken(session.userId);
    const hashedAccessToken = UserSessionService.hashToken(newAccessToken);


    const updatedSession = await prisma.userSession.update({
      where: { sessionId: session.sessionId },
      data: {
        accessToken: hashedAccessToken,
        refreshToken: hashedRefreshToken,
        sessionExpiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
      },
    });


    return UserSessionService.omitSensitiveFields(updatedSession);
  }



  /**
   * Destroy all other sessions of the user.
   * 
   * @param userSession - The current user session.
   * @returns A promise that resolves when the sessions are destroyed.
   */
  static async destroyOtherSessions(userSession: UserSessionOmit): Promise<void> {
    // Get all sessions of the user
    const sessions = await prisma.userSession.findMany({
      where: { userId: userSession.userId },
    });

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
   * Deletes a user session by token.
   * @param token - The session token.
   */

  static async deleteSession(data: UserSessionOmit): Promise<void> {

    await prisma.userSession.deleteMany({
      where: { sessionId: data.sessionId },
    });

  }
}
