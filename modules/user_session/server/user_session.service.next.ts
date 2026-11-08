import Logger from '@kuraykaraaslan-labs/logger';
// Utils
import { SafeUserSession, type SessionMeta } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { NextRequest } from 'next/server';
import { SafeUser, SafeUserSchema } from '@kuraykaraaslan-labs/user/server/user.types';
import UserSessionMessages from "@kuraykaraaslan-labs/user_session/server/user_session.messages";
import UserSessionService from '@kuraykaraaslan-labs/user_session/server/user_session.service';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import UserSessionNextHelpers from './user_session.next.helpers';
import UserSessionSessionNextService from './user_session.session.service.next';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { sessionStepUpRequired } from './user_session.step-up-flag';

export { UserSessionNextHelpers, UserSessionSessionNextService };

export default class UserSessionNextService {

  // Helpers
  static generateDeviceFingerprint = UserSessionNextHelpers.generateDeviceFingerprint.bind(UserSessionNextHelpers);

  // Session lifecycle
  static createSession = UserSessionSessionNextService.createSession.bind(UserSessionSessionNextService);
  static getSessionWithUser = UserSessionSessionNextService.getSessionWithUser.bind(UserSessionSessionNextService);
  static getSession = UserSessionSessionNextService.getSession.bind(UserSessionSessionNextService);
  static logout = UserSessionSessionNextService.logout.bind(UserSessionSessionNextService);
  static deleteSession = UserSessionSessionNextService.deleteSession.bind(UserSessionSessionNextService);

  /**
   * Authenticate a user by Next.js request.
   * @param request - The Next.js request object.
   * @param requiredUserRole - The required user role.
   * @param otpVerifyBypass - Whether to bypass OTP verification.
   * @param passwordChangeBypass - auth.05: the route is part of the forced change-password step (auth_abac
   *   PASSWORD_CHANGE_STEP_PERMISSIONS); every other route refuses a session that must change its password.
   * @param sessionStepUpBypass - phase 55 00.6: the route is part of the step-up a session was asked for (auth_abac
   *   SESSION_STEP_UP_PERMISSIONS); every other route refuses that session 401 SESSION_STEP_UP_REQUIRED.
   * @returns The authenticated user and session, or null for GUEST.
   */
  static async authenticateUserByRequest<T extends string = "USER">({
    request,
    requiredUserRole = "USER" as T,
    otpVerifyBypass = false,
    passwordChangeBypass = false,
    sessionStepUpBypass = false,
  }: {
    request: NextRequest;
    requiredUserRole?: T;
    otpVerifyBypass?: boolean;
    passwordChangeBypass?: boolean;
    sessionStepUpBypass?: boolean;
  }): Promise<
    T extends "GUEST"
      ? null
      : { user: SafeUser; userSession: SafeUserSession }
  > {
    try {
      const cookieAccessToken = request.cookies.get("accessToken")?.value;
      const cookieRefreshToken = request.cookies.get("refreshToken")?.value;

      // A native app (phone, tablet, watch, TV, …) has no cookie jar — it
      // carries its tenant-scoped access token itself as
      // `Authorization: Bearer <token>`, minted with audience 'device' (see
      // auth-device-login.route.ts). No device fingerprint is bound to it
      // (getSessionWithUser skips that check for this audience) — the
      // audience claim plus the tenant claim plus TLS is the device trust
      // model, not a fingerprint tuned for a browser.
      const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
      const bearerMatch = !cookieAccessToken && authHeader ? /^Bearer\s+(.+)$/i.exec(authHeader.trim()) : null;
      const bearerAccessToken = bearerMatch?.[1]?.trim();

      const accessToken = cookieAccessToken ?? bearerAccessToken;
      const audience = cookieAccessToken ? 'web' : 'device';

      if (!accessToken || (cookieAccessToken && !cookieRefreshToken)) {
        throw new AppError(UserSessionMessages.USER_NOT_AUTHENTICATED, 401, ErrorCode.UNAUTHORIZED);
      }

      const { user, userSession } = await this.getSession({
        accessToken,
        request,
        otpVerifyBypass,
        audience,
      });

      if (!user) {
        throw new AppError(UserSessionMessages.USER_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
      }

      // S6 / F.user_session.01: a SUSPENDED, INACTIVE or DELETED account is refused on every request, however live its
      // session (sign-in already refuses anything but ACTIVE). The user row is read fresh per request (getSessionWithUser).
      if (user.userStatus !== 'ACTIVE') {
        throw new AppError(UserSessionMessages.USER_NOT_ACTIVE, 401, ErrorCode.UNAUTHORIZED);
      }

      if (userSession.otpVerifyNeeded && !otpVerifyBypass) {
        throw new AppError(UserSessionMessages.OTP_REQUIRED, 401, ErrorCode.OTP_REQUIRED);
      }

      // Phase 55 00.6: an administrator or the firewall asked this session to prove a second factor again. Every route but the
      // step-up itself (and reading the session) answers 401 with `details.stepUp`, the shape requireStepUp uses, so the client's
      // step-up dialog handles it; a successful step-up on this session clears the flag. Before the password-change step: a
      // session under suspicion proves its factor before it may change the password.
      if ((userSession.metadata as SessionMeta | null | undefined)?.stepUpRequired && !sessionStepUpBypass) {
        throw sessionStepUpRequired();
      }

      // auth.05: a session that must change its password reaches the change-password step only (403, the client goes
      // to the change-password page). Asked after the OTP step, so the second factor still comes first.
      if ((userSession.metadata as SessionMeta | null | undefined)?.passwordChangeRequired === true && !passwordChangeBypass) {
        throw new AppError(UserSessionMessages.PASSWORD_CHANGE_REQUIRED, 403, ErrorCode.PASSWORD_CHANGE_REQUIRED);
      }

      // Check if the session is expired
      if (userSession.sessionExpiry < new Date()) {
        throw new AppError(UserSessionMessages.SESSION_EXPIRED, 401, ErrorCode.SESSION_EXPIRED);
      }

      // Role-based check
      const userRoleKeys = ["GUEST", "USER", "ADMIN"];
      const requiredUserRoleKeyIndex = userRoleKeys.indexOf(requiredUserRole);
      const userRoleKeyIndex = userRoleKeys.indexOf(user.userRole);

      if (userRoleKeyIndex < requiredUserRoleKeyIndex) {
        throw new AppError(UserSessionMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE, 403, ErrorCode.FORBIDDEN);
      }

      request.user = user;
      request.userSession = userSession;

      // Detect and attach impersonation context
      const meta = userSession.metadata as SessionMeta | null | undefined;
      if (meta?.impersonation) {
        request.isImpersonating = true;
        try {
          const ds2 = await getDataSource();
          const impersonatorUser = await ds2.getRepository(UserEntity).findOne({
            where: { userId: meta.impersonation.impersonatorUserId },
          });
          if (impersonatorUser) {
            request.impersonatedBy = SafeUserSchema.parse(impersonatorUser);
          }
        } catch {
          // Non-critical — best effort
        }
      }

      return requiredUserRole === "GUEST" ? (null as any) : ({ user, userSession } as any);
    } catch (error: any) {
      const message: string = error?.message ?? "unknown error";

      // An expired access token is the *normal* steady state of a short-lived
      // token, not an incident: the client refreshes and replays. Same for a
      // session row whose access-token hash was just rotated away by a
      // concurrent refresh. Logging these at error level buried real auth
      // failures under one line per user per token lifetime.
      const SELF_HEALING = new Set<string>([
        UserSessionMessages.TOKEN_EXPIRED,
        UserSessionMessages.SESSION_NOT_FOUND,
      ]);
      if (SELF_HEALING.has(message)) {
        Logger.debug(`[AUTHENTICATE] ${message} — client will refresh`);
      } else {
        Logger.error(`[AUTHENTICATE ERROR] ${message}`);
      }

      if (requiredUserRole === "GUEST") {
        request.user = null;
        return null as any;
      }

      // Every auth failure must reach the browser as its own 401/403 carrying
      // the real message — that string is the client's only signal for what to
      // do next (refresh / go to login / show 403). Previously anything outside
      // `preserved` was rethrown as a bare `Error`, and `normalizeError` maps a
      // non-AppError to 500 "Internal server error": SESSION_NOT_FOUND (the
      // token was rotated by a concurrent refresh — recoverable) and
      // USER_NOT_AUTHENTICATED both arrived as opaque 500s, so the axios
      // interceptor never refreshed and never redirected. The page just broke
      // until the user reloaded it by hand.
      //
      // - TOKEN_EXPIRED / SESSION_NOT_FOUND      → axios refreshes and replays
      // - SESSION_EXPIRED / REVOKED / INVALID    → axios redirects to login
      // - OTP_REQUIRED                           → client goes to the OTP page
      // - USER_DOES_NOT_HAVE_REQUIRED_*          → 403, no login redirect
      if (error instanceof AppError) throw error;

      const preserved = new Set<string>([
        UserSessionMessages.TOKEN_EXPIRED,
        UserSessionMessages.SESSION_EXPIRED,
        UserSessionMessages.SESSION_NOT_FOUND,
        UserSessionMessages.SESSION_REVOKED,
        UserSessionMessages.INVALID_TOKEN,
        UserSessionMessages.REFRESH_TOKEN_REUSED,
        UserSessionMessages.DEVICE_FINGERPRINT_MISMATCH,
        UserSessionMessages.OTP_REQUIRED,
        UserSessionMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE,
        UserSessionMessages.USER_DOES_NOT_HAVE_REQUIRED_SCOPE,
      ]);
      if (preserved.has(message)) {
        const status = message === UserSessionMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE
          || message === UserSessionMessages.USER_DOES_NOT_HAVE_REQUIRED_SCOPE ? 403 : 401;
        throw new AppError(message, status, status === 403 ? ErrorCode.FORBIDDEN : ErrorCode.UNAUTHORIZED);
      }
      throw new AppError(UserSessionMessages.USER_NOT_AUTHENTICATED, 401, ErrorCode.UNAUTHORIZED);
    }
  }

  /**
   * Read-only "is the visitor logged in?" check for *page* / middleware auth
   * gates — the counterpart to authenticateUserByRequest (which API routes use
   * for the full user+session result and which logs auth failures). This rotates
   * nothing and logs nothing; it just answers whether the admin shell should be
   * painted.
   *
   * Returns true when EITHER:
   *  - the access token still backs a live session (validated against the store,
   *    not just the JWT — a JWT can be unexpired while its session is idle- or
   *    absolutely-expired), OR
   *  - the session is expired-but-refreshable, so the client-side axios
   *    interceptor will transparently refresh it.
   *
   * A genuinely dead session (expired, revoked, beyond the absolute deadline)
   * returns false so the caller redirects to login.
   */
  static async hasUsableSession(request: NextRequest): Promise<boolean> {
    const accessToken = request.cookies.get("accessToken")?.value;
    if (accessToken) {
      try {
        await UserSessionService.getSession({
          accessToken,
          deviceFingerprint: this.generateDeviceFingerprint(request),
        });
        return true;
      } catch {
        /* access token expired / session not live → fall back to refresh check */
      }
    }

    const refreshToken = request.cookies.get("refreshToken")?.value;
    if (refreshToken) {
      try {
        if (await UserSessionService.isSessionRefreshable(refreshToken)) return true;
      } catch {
        /* treat any lookup failure as "not usable" */
      }
    }

    return false;
  }
}
