import Logger from '@kuraykaraaslan-labs/logger';
// Utils
import { SafeUserSession, SafeUserSessionSchema } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { NextRequest } from 'next/server';
import { SafeUser, SafeUserSchema } from '@kuraykaraaslan-labs/user/server/user.types';
import UserSessionMessages from "@kuraykaraaslan-labs/user_session/server/user_session.messages";
import { SafeUserSecurity } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import UserSessionService from '@kuraykaraaslan-labs/user_session/server/user_session.service';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import UserSessionNextHelpers from './user_session.next.helpers';
import { TRUSTED_DEVICE_COOKIE, isSecureRequest } from './user_session.cookie.next';
import { DEVICE_ID_COOKIE, deviceIdCookieOptions, newDeviceId, parseDeviceId } from './user_session.device-id';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * D28: the browser's device id (user_session.device-id.ts): the request's `device-id` cookie when it is one of ours, else a new one,
 * and the cookie is (re)set on the response of the route that signs the person in (a sliding year). A route handler's `cookies()` store
 * is merged into whatever response the handler returns, so the ~15 sign-in routes need no change of their own. Outside a request scope
 * (a test, a script) there is no store: the id is still returned, nothing is set, and the next sign-in is simply another device.
 */
async function resolveDeviceId(request: NextRequest): Promise<string> {
  const deviceId = parseDeviceId(request.cookies?.get(DEVICE_ID_COOKIE)?.value) ?? newDeviceId();
  try {
    const { cookies } = await import('next/headers');
    (await cookies()).set(DEVICE_ID_COOKIE, deviceId, deviceIdCookieOptions(isSecureRequest(request)));
  } catch {
    /* no request scope */
  }
  return deviceId;
}

export default class UserSessionSessionNextService {

  /**
   * Creates a new user session from a Next.js request.
   * @param user - The safe user object.
   * @param request - The Next.js request object.
   * @param userSecurity - The user security settings.
   * @param otpIgnore - Whether to ignore OTP verification.
   * @returns The created session with raw tokens.
   */
  static async createSession({
    user,
    request,
    userSecurity,
    otpIgnore = false,
    rememberMe = false,
    tenantId,
    audience,
    device,
    accountOnly = false,
    amr,
    fleetId,
    passwordChangeRequired,
  }: {
    user: SafeUser;
    request: NextRequest;
    userSecurity: SafeUserSecurity;
    otpIgnore?: boolean;
    /** "Remember me" was ticked at login — widen the session window + cap. */
    rememberMe?: boolean;
    // The tenant this session is scoped to (the tenant the caller just
    // authenticated a membership against). Required — every session is
    // tenant-bound, see user_session.crud.service.createSession.
    tenantId: string;
    audience?: import('./user_session.token.service').TokenAudience;
    /** Self-reported hardware (native app login) — merged over the UA-derived guess. */
    device?: import('./user_session.types').SessionMeta['device'];
    /** Central login: a root-tenant session without a root membership (SessionMeta.accountOnly). */
    accountOnly?: boolean;
    /** The methods this login proved (RFC 8176), see user_session.amr.ts. */
    amr?: readonly string[];
    /** A Fleet ID login (FID-07): the ID token's `sid` and the session's hard cap in hours. */
    fleetId?: { sid: string | null; maxHours: number; notAfter?: string };
    /** auth.05: the login found the password expired (SessionMeta.passwordChangeRequired). */
    passwordChangeRequired?: boolean;
  }): Promise<{
    userSession: SafeUserSession;
    rawAccessToken: string;
    rawRefreshToken: string;
  }> {
    const deviceFingerprint = UserSessionNextHelpers.generateDeviceFingerprint(request);
    const userAgent = request.headers.get("user-agent") || undefined;
    const ipAddress = clientIpOf(request.headers);

    // 38-security 3.4: a valid trusted-device cookie of THIS user (hash match, unexpired) suppresses the risk step-up. Cookie sessions
    // only; never keyed on the UA or IP, and an unreadable store means "not trusted".
    const trustedToken = audience === 'device' ? undefined : request.cookies?.get(TRUSTED_DEVICE_COOKIE)?.value;
    let trustedDevice = false;
    if (trustedToken) {
      try {
        const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
        trustedDevice = await UserSecurityService.isDeviceTrusted(user.userId, trustedToken);
      } catch {
        trustedDevice = false;
      }
    }

    const deviceId = await resolveDeviceId(request);

    return UserSessionService.createSession({
      user,
      userSecurity,
      deviceFingerprint,
      deviceId,
      device,
      userAgent,
      ipAddress,
      otpIgnore,
      rememberMe,
      tenantId,
      audience,
      accountOnly,
      amr,
      fleetId,
      passwordChangeRequired,
      ...(trustedDevice ? { trustedDevice } : {}),
    });
  }

  /**
   * Gets a user session by token from a Next.js request.
   * @param accessToken - The session token.
   * @param request - The Next.js request object.
   * @param otpVerifyBypass - Whether to bypass OTP verification.
   * @returns The user and session.
   */
  static async getSessionWithUser({
    accessToken,
    request,
    otpVerifyBypass = false,
    audience = 'web',
  }: {
    accessToken: string;
    request: NextRequest;
    otpVerifyBypass?: boolean;
    // 'device' for a Bearer-header caller (no cookie, no device-fingerprint
    // binding — see authenticateUserByRequest's header fallback).
    audience?: import('./user_session.token.service').TokenAudience;
  }): Promise<{ user: SafeUser; userSession: SafeUserSession }> {
    const deviceFingerprint = audience === 'web' ? UserSessionNextHelpers.generateDeviceFingerprint(request) : undefined;
    // Verify with the caller's audience first, so a token for the wrong audience never reaches the session lookup.
    UserSessionService.verifyAccessToken(accessToken, deviceFingerprint, audience);

    // The session through the one session reader (its cache entry, idle-timeout and OTP checks), rather than a
    // second cache entry of a different shape under the same key: the two readers used to delete each other's entry
    // as "invalid" on every alternating call (known bug user_session.03).
    const userSession = await UserSessionService.getSession({
      accessToken,
      deviceFingerprint,
      otpVerifyBypass,
      // user_session.05: without the audience the reader verified a device token as 'web' again and refused every cold request.
      audience,
    });

    // The user row is read fresh on every request (F.user_session.01 / S6): its status and platform role decide whether
    // the live session may act at all, and a cached copy (it used to live 1800 s under session:<userId>:user) kept a
    // suspended, deleted or demoted account working until it expired. One primary-key read; the session itself stays cached.
    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { userId: userSession.userId } });

    if (!user) {
      throw new Error(UserSessionMessages.USER_NOT_FOUND);
    }

    const safeUser = SafeUserSchema.parse(user);
    return { user: safeUser, userSession };
  }

  /**
   * Get session from Next.js request.
   * @param accessToken - The access token.
   * @param request - The Next.js request object.
   * @param otpVerifyBypass - Whether to bypass OTP verification.
   * @returns The user and session.
   */
  static async getSession({
    accessToken,
    request,
    otpVerifyBypass = false,
    audience = 'web',
  }: {
    accessToken: string;
    request: NextRequest;
    otpVerifyBypass?: boolean;
    audience?: import('./user_session.token.service').TokenAudience;
  }): Promise<{ user: SafeUser; userSession: SafeUserSession }> {
    return this.getSessionWithUser({ accessToken, request, otpVerifyBypass, audience });
  }

  static async logout({ request }: { request: NextRequest }): Promise<void> {
    // A native app has no cookie jar: it sends its access token as `Authorization: Bearer`.
    // Without this, a device sign-out answered 200 and revoked nothing, leaving the session
    // and its refresh token alive. Possession of the token is the proof; a cookie wins if both exist.
    const cookieToken = request.cookies.get("accessToken")?.value;
    const bearerToken = cookieToken ? undefined : /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") ?? "").trim())?.[1]?.trim();
    const accessToken = cookieToken ?? bearerToken;
    if (!accessToken) return;

    // Revoke by the raw access token: the session row stores hashToken(accessToken),
    // so this deletes the DB row (and thus invalidates the still-live refresh token)
    // WITHOUT depending on a Redis cache entry that may have expired/evicted or on the
    // access token still being unexpired. The previous implementation sourced the
    // session id only from Redis and passed `null!` to deleteSession on a cache miss,
    // which silently no-op'd — leaving the session (and its 7-day refresh token) alive
    // after a "successful" logout.
    const deleted = await UserSessionService.deleteSessionByAccessToken(accessToken);
    if (!deleted) {
      Logger.warn('[UserSessionNextService.logout] no session row matched the access token; nothing to revoke');
    }
  }

  static async deleteSession(userSession: SafeUserSession): Promise<void> {
    await UserSessionService.deleteSession(userSession.userSessionId);
  }
}
