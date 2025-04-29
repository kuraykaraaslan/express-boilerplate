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


const ACCESS_TOKEN_SECRET: jwt.Secret = process.env.ACCESS_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || '1h'; // veya '1h' gibi

const REFRESH_TOKEN_SECRET: jwt.Secret = process.env.REFRESH_TOKEN_SECRET!;
const REFRESH_TOKEN_EXPIRES_IN: string | number = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'; // veya '7d' gibi

export default class UserSessionService {

  static readonly UserSessionOmitSelect = {
    userId: true,
    sessionId: true,
    accessToken: true,
    refreshToken: true,
    tenantId: true,
    tenantUserId: true,
    tenant: {
      select: TenantService.TenantOmitSelect,
    },
    tenantUser: {
      select: TenantUserService.TenantUserOmitSelect,
    },
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
  static async createSession(user: UserOmit, request: Request<any>, otpConsired: boolean = false): Promise<UserSession> {

    const userAgentData = await UserAgentUtil.parseRequest(request);

    return prisma.userSession.create({
      data: {
        userId: user.userId,
        accessToken: UserSessionService.generateAccessToken(user.userId),
        refreshToken: UserSessionService.generateRefreshToken(user.userId),
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
  }

  /**
   * Gets a user session by token.
   * @param accessToken - The session token.
   * @returns The user session.
   */
  static async getSession(data: GetSessionRequest): Promise<LoginResponse> {

    const session = await prisma.userSession.findUnique({
      where: { accessToken: data.accessToken },
      select: UserSessionService.UserSessionOmitSelect,
    })

    if (!session) {
      throw new Error(AuthErrors.SESSION_NOT_FOUND);
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { userId: session.userId },
    })

    return {
      user: UserService.omitSensitiveFields(user),
      //@ts-ignore
      userSession: AuthService.omitSensitiveFields(session),
    };

  }
  static omitSensitiveFields(session: UserSession): UserSessionOmit {
    return {
      userId: session.userId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
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
    const newAccessToken = UserSessionService.generateAccessToken(session.userId);

    
    const updatedSession = await prisma.userSession.update({
      where: { sessionId: session.sessionId },
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        sessionExpiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 7 days
      },
    });
    

    return UserSessionService.omitSensitiveFields(session);
  }


}
