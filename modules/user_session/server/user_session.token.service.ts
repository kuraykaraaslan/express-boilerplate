import { env } from '@kuraykaraaslan-labs/env';
import jwt, { Secret } from "jsonwebtoken";
import crypto from "crypto";
import UserSessionMessages from "./user_session.messages";
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

const APPLICATION_DOMAIN = env.APPLICATION_DOMAIN || "localhost";
const ACCESS_TOKEN_SECRET = env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_EXPIRES_IN = env.ACCESS_TOKEN_EXPIRES_IN || "1h";
const REFRESH_TOKEN_SECRET = env.REFRESH_TOKEN_SECRET;
const REFRESH_TOKEN_EXPIRES_IN = env.REFRESH_TOKEN_EXPIRES_IN || "7d";

// Both tokens are HMAC-signed with a symmetric secret. Pin the algorithm on
// BOTH sign and verify so a token can only ever be HS256 — without an explicit
// `algorithms` allow-list, `jwt.verify` accepts any algorithm the key type
// admits, which is the classic surface for algorithm-confusion downgrades.
const JWT_ALGORITHM = "HS256" as const;

// A token minted for the web client is only ever accepted back from the web
// client, and likewise for a device — this stops a stolen device bearer
// token from being replayed into the cookie-based web flow (or vice versa),
// on top of the `tenantId` binding below. "device" (not "mobile"): the
// Bearer flow this backs is used from phones, tablets, watches, TVs — any
// client with no cookie jar, not phones alone.
export type TokenAudience = "web" | "device";

export interface TokenPayload {
  userId: string;
  userSessionId: string;
  // Every session is scoped to exactly one tenant — a user with several
  // tenant memberships holds one UserSession (and one token pair) per tenant.
  tenantId: string;
  deviceFingerprint?: string;
  impersonation?: {
    impersonatorUserId: string;
    impersonatorSessionId: string;
    tenantId?: string;
    targetTenantRole?: string;
  };
}

/**
 * Does the device fingerprint include the caller's IP?
 *
 * In production it does: the deployment sits behind a fixed proxy, and binding
 * the session to the network path is a cheap extra hurdle for a stolen cookie.
 *
 * Outside production it does NOT. A dev machine's apparent IP moves constantly —
 * localhost vs LAN address vs a tunnel, IPv4 vs IPv6 loopback, wifi↔mobile
 * handoff, VPN toggles — and because the fingerprint is baked into the JWT at
 * login and re-derived on every request, each of those changes killed the
 * session outright. That is not a security signal in dev, it is a session that
 * dies several times an hour for no reason.
 *
 * The user-agent stays in either way: it is what actually catches a cookie
 * replayed from a different browser or OS.
 */
export const FINGERPRINT_INCLUDES_IP = env.NODE_ENV === 'production' || env.NODE_ENV === 'vercel';

export default class UserSessionTokenService {
  static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  static generateDeviceFingerprint(headers: {
    ip?: string;
    userAgent?: string;
    acceptLanguage?: string;
  }): string {
    const ip = FINGERPRINT_INCLUDES_IP ? headers.ip || "" : "";
    const raw = `${ip}|${headers.userAgent || ""}|${headers.acceptLanguage || ""}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  /** `expiresInSeconds` overrides the configured lifetime (a break-glass session lives exactly as long as its grant, never refreshed). */
  static generateAccessToken(payload: TokenPayload, audience: TokenAudience = "web", expiresInSeconds?: number): string {
    return (jwt.sign as (p: object, k: jwt.Secret, o: object) => string)(payload, ACCESS_TOKEN_SECRET, {
      algorithm: JWT_ALGORITHM,
      subject: payload.userId,
      issuer: APPLICATION_DOMAIN,
      audience,
      expiresIn: expiresInSeconds ?? ACCESS_TOKEN_EXPIRES_IN,
    });
  }

  /**
   * NOTE: no `notBefore`. It used to carry `notBefore: 5`, which made every
   * freshly-minted refresh token unusable for its first 5 seconds. Because a
   * refresh *rotates* the refresh token, that window opened on every login and
   * every refresh — and any refresh landing inside it failed with
   * `NotBeforeError`, which verifyRefreshToken reported as INVALID_TOKEN, which
   * the client treats as an unrecoverable session and bounces to login. A
   * refresh token is a random-per-session bearer credential; delaying its
   * validity buys no security, it only manufactures spurious logouts.
   */
  static generateRefreshToken(payload: TokenPayload, audience: TokenAudience = "web", expiresInSeconds?: number): string {
    return (jwt.sign as (p: object, k: jwt.Secret, o: object) => string)(payload, REFRESH_TOKEN_SECRET, {
      algorithm: JWT_ALGORITHM,
      subject: payload.userId,
      issuer: APPLICATION_DOMAIN,
      audience,
      expiresIn: expiresInSeconds ?? REFRESH_TOKEN_EXPIRES_IN,
    });
  }

  static verifyAccessToken(token: string, deviceFingerprint?: string, audience: TokenAudience = "web"): TokenPayload {
    try {
      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET as Secret, {
        algorithms: [JWT_ALGORITHM],
        issuer: APPLICATION_DOMAIN,
        audience,
      }) as TokenPayload;

      if (deviceFingerprint && decoded.deviceFingerprint !== deviceFingerprint) {
        throw new AppError(UserSessionMessages.DEVICE_FINGERPRINT_MISMATCH, 401, ErrorCode.UNAUTHORIZED);
      }

      return decoded;
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(UserSessionMessages.TOKEN_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
      }
      throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
    }
  }

  static verifyRefreshToken(token: string, audience: TokenAudience = "web"): TokenPayload {
    try {
      return jwt.verify(token, REFRESH_TOKEN_SECRET, {
        algorithms: [JWT_ALGORITHM],
        issuer: APPLICATION_DOMAIN,
        audience,
      }) as TokenPayload;
    } catch (error: unknown) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(UserSessionMessages.TOKEN_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
      }
      throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
    }
  }
}
