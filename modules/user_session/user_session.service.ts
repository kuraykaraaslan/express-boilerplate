import 'reflect-metadata';
import { Request } from 'express';
import { Not, MoreThan } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import redis from '@/libs/redis';
import { env } from '@/libs/env';

import { UserSession as UserSessionEntity } from './entities/UserSession';
import {
  SafeUserSession,
  SafeUserSessionSchema,
} from './user_session.types';
import { UserSessionMessages } from './user_session.messages';
import { GetSessionInput } from './user_session.dto';
import { SafeUser } from '@/modules/user/user.types';
import UserService from '@/modules/user/user.service';
import UserAgentUtil from '@/modules/auth/utils/user-agent.util';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_SECRET = env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = env.ACCESS_TOKEN_EXPIRES_IN ?? '3d';

const REFRESH_TOKEN_SECRET = env.REFRESH_TOKEN_SECRET;
const REFRESH_TOKEN_EXPIRES_IN = env.REFRESH_TOKEN_EXPIRES_IN ?? '7d';

const SESSION_EXPIRY_MS = env.SESSION_EXPIRY_MS ?? 1000 * 60 * 60 * 24 * 7; // 7 days
const SESSION_CACHE_TTL = env.SESSION_CACHE_TTL; // seconds

const APPLICATION_DOMAIN = env.APPLICATION_DOMAIN ?? 'localhost';

// ── Token payload ─────────────────────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  userSessionId: string;
  deviceFingerprint?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export default class UserSessionService {
  private static get repo() {
    return AppDataSource.getRepository(UserSessionEntity);
  }

  // ── Token generation ───────────────────────────────────────────────────────

  private static generateAccessToken(
    userId: string,
    userSessionId: string,
    deviceFingerprint: string,
  ): string {
    return (jwt.sign as Function)(
      { userId, userSessionId, deviceFingerprint } satisfies TokenPayload,
      ACCESS_TOKEN_SECRET,
      {
        subject: userId,
        issuer: APPLICATION_DOMAIN,
        audience: 'web',
        expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      },
    );
  }

  private static generateRefreshToken(
    userId: string,
    userSessionId: string,
    deviceFingerprint: string,
  ): string {
    return (jwt.sign as Function)(
      { userId, userSessionId, deviceFingerprint } satisfies TokenPayload,
      REFRESH_TOKEN_SECRET,
      {
        subject: userId,
        issuer: APPLICATION_DOMAIN,
        audience: 'web',
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
        notBefore: 5,
      },
    );
  }

  // ── Token verification ─────────────────────────────────────────────────────

  static decodeAccessToken(
    token: string,
    fingerprint: string,
  ): { userId: string; userSessionId: string } {
    try {
      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
        issuer: APPLICATION_DOMAIN,
        audience: 'web',
      }) as TokenPayload;

      if (decoded.deviceFingerprint !== fingerprint) {
        throw new AppError(
          UserSessionMessages.DEVICE_FINGERPRINT_NOT_MATCH,
          401,
          ErrorCode.UNAUTHORIZED,
        );
      }

      return { userId: decoded.userId, userSessionId: decoded.userSessionId };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError(UserSessionMessages.TOKEN_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
      }
      throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
    }
  }

  static decodeRefreshToken(token: string): { userId: string; userSessionId: string } {
    try {
      const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET, {
        issuer: APPLICATION_DOMAIN,
        audience: 'web',
      }) as TokenPayload;

      return { userId: decoded.userId, userSessionId: decoded.userSessionId };
    } catch (err: unknown) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError(UserSessionMessages.TOKEN_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
      }
      throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
    }
  }

  // ── Hashing ────────────────────────────────────────────────────────────────

  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  // ── Device fingerprint ─────────────────────────────────────────────────────

  static async generateDeviceFingerprint(request: Request): Promise<string> {
    const ip =
      (request.headers['x-forwarded-for'] as string) ||
      request.socket.remoteAddress ||
      '';
    const userAgent = request.headers['user-agent'] || '';
    const acceptLanguage = request.headers['accept-language'] || '';

    const raw = `${ip}|${userAgent}|${acceptLanguage}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  // ── Redis helpers ──────────────────────────────────────────────────────────

  static async setRedisSession(
    hashedToken: string,
    session: SafeUserSession,
  ): Promise<void> {
    const key = `user-session:${hashedToken}`;
    await redis.setex(key, SESSION_CACHE_TTL, JSON.stringify(session));
  }

  static async getRedisSession(hashedToken: string): Promise<SafeUserSession | null> {
    const key = `user-session:${hashedToken}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return SafeUserSessionSchema.parse(JSON.parse(raw));
    } catch {
      await redis.del(key);
      return null;
    }
  }

  static async deleteRedisSession(hashedToken: string): Promise<void> {
    const key = `user-session:${hashedToken}`;
    await redis.del(key);
  }

  // ── Session CRUD ───────────────────────────────────────────────────────────

  static async createSession(
    user: SafeUser,
    request: Request,
    otpIgnore: boolean = false,
  ): Promise<{ userSession: SafeUserSession; rawAccessToken: string; rawRefreshToken: string }> {
    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);
    const userAgentData = UserAgentUtil.parseRequest(request);
    const userSessionId = uuidv4();

    const rawAccessToken = UserSessionService.generateAccessToken(
      user.userId,
      userSessionId,
      deviceFingerprint,
    );
    const rawRefreshToken = UserSessionService.generateRefreshToken(
      user.userId,
      userSessionId,
      deviceFingerprint,
    );

    const otpVerifyNeeded = false; // OTP is handled separately via user security settings

    const session = UserSessionService.repo.create({
      userSessionId,
      userId: user.userId,
      accessToken: UserSessionService.hashToken(rawAccessToken),
      refreshToken: UserSessionService.hashToken(rawRefreshToken),
      sessionExpiry: new Date(Date.now() + SESSION_EXPIRY_MS),
      deviceFingerprint,
      otpVerifyNeeded,
      ip: userAgentData.ip ?? 'Unknown',
      os: userAgentData.os ?? 'Unknown',
      device: userAgentData.device ?? 'Unknown',
      browser: userAgentData.browser ?? 'Unknown',
      city: userAgentData.city ?? 'Unknown',
      state: userAgentData.state ?? 'Unknown',
      country: userAgentData.country ?? 'Unknown',
    });

    const saved = await UserSessionService.repo.save(session);
    const safeSession = UserSessionService.omitSensitiveFields(saved);

    await UserSessionService.setRedisSession(
      UserSessionService.hashToken(rawAccessToken),
      safeSession,
    );

    return { userSession: safeSession, rawAccessToken, rawRefreshToken };
  }

  static async getSession(
    data: GetSessionInput,
    request: Request,
  ): Promise<{ userSession: SafeUserSession }> {
    const hashedToken = UserSessionService.hashToken(data.accessToken);

    // Try Redis cache first
    const cached = await UserSessionService.getRedisSession(hashedToken);
    if (cached) {
      return { userSession: cached };
    }

    // Fall back to DB
    const { userSession } = await UserSessionService.getSessionDangerously(data, request);
    return { userSession };
  }

  static async getSessionDangerously(
    data: GetSessionInput,
    request: Request,
  ): Promise<{ user: SafeUser; userSession: SafeUserSession }> {
    if (!data.accessToken) {
      throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
    }

    const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);
    const hashedToken = UserSessionService.hashToken(data.accessToken);

    const { userId, userSessionId } = UserSessionService.decodeAccessToken(
      data.accessToken,
      deviceFingerprint,
    );

    const session = await UserSessionService.repo.findOne({
      where: {
        userSessionId,
        accessToken: hashedToken,
        sessionExpiry: MoreThan(new Date()),
      },
    });

    if (!session || session.userId !== userId) {
      throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
    }

    if (session.otpVerifyNeeded) {
      throw new AppError(UserSessionMessages.OTP_NEEDED, 401, ErrorCode.OTP_REQUIRED);
    }

    if (session.deviceFingerprint !== deviceFingerprint) {
      throw new AppError(
        UserSessionMessages.DEVICE_FINGERPRINT_NOT_MATCH,
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    const user = await UserService.findById(session.userId);

    return {
      user,
      userSession: UserSessionService.omitSensitiveFields(session),
    };
  }

  static async refreshAccessToken(refreshToken: string): Promise<{
    userSession: SafeUserSession;
    rawAccessToken: string;
    rawRefreshToken: string;
  }> {
    const { userId, userSessionId } = UserSessionService.decodeRefreshToken(refreshToken);
    const hashedRefreshToken = UserSessionService.hashToken(refreshToken);

    const session = await UserSessionService.repo.findOne({
      where: { refreshToken: hashedRefreshToken, userId },
    });

    if (!session) {
      throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
    }

    if (session.sessionExpiry < new Date()) {
      throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
    }

    if (session.otpVerifyNeeded) {
      throw new AppError(UserSessionMessages.OTP_NEEDED, 401, ErrorCode.OTP_REQUIRED);
    }

    // Refresh token reuse check
    if (session.refreshToken !== hashedRefreshToken) {
      await UserSessionService.repo.delete({ userId: session.userId });
      throw new AppError(
        UserSessionMessages.REFRESH_TOKEN_REUSED,
        401,
        ErrorCode.UNAUTHORIZED,
      );
    }

    const fingerprint = session.deviceFingerprint ?? '';
    const newAccessToken = UserSessionService.generateAccessToken(
      session.userId,
      session.userSessionId,
      fingerprint,
    );
    const newRefreshToken = UserSessionService.generateRefreshToken(
      session.userId,
      session.userSessionId,
      fingerprint,
    );

    await UserSessionService.repo.update(
      { userSessionId: session.userSessionId },
      {
        accessToken: UserSessionService.hashToken(newAccessToken),
        refreshToken: UserSessionService.hashToken(newRefreshToken),
        sessionExpiry: new Date(Date.now() + SESSION_EXPIRY_MS),
      },
    );

    // Invalidate old cache
    await UserSessionService.deleteRedisSession(hashedRefreshToken);

    const updated = await UserSessionService.repo.findOne({
      where: { userSessionId: session.userSessionId },
    });
    const safeSession = UserSessionService.omitSensitiveFields(updated!);

    await UserSessionService.setRedisSession(
      UserSessionService.hashToken(newAccessToken),
      safeSession,
    );

    return { userSession: safeSession, rawAccessToken: newAccessToken, rawRefreshToken: newRefreshToken };
  }

  static async destroyOtherSessions(userSession: SafeUserSession): Promise<void> {
    await UserSessionService.repo.delete({
      userId: userSession.userId,
      userSessionId: Not(userSession.userSessionId),
    });
  }

  static async deleteSession(userSession: SafeUserSession): Promise<void> {
    const session = await UserSessionService.repo.findOne({
      where: { userSessionId: userSession.userSessionId },
    });

    if (!session) {
      throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    await UserSessionService.deleteRedisSession(session.accessToken);
    await UserSessionService.repo.delete({
      userSessionId: userSession.userSessionId,
      userId: userSession.userId,
    });
  }

  static async deleteAllUserSessions(userId: string): Promise<void> {
    await UserSessionService.repo.delete({ userId });
  }

  static omitSensitiveFields(session: UserSessionEntity): SafeUserSession {
    return SafeUserSessionSchema.parse(session);
  }
}
