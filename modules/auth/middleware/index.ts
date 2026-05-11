import { NextFunction, Request, Response } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import { SafeUser } from '@/modules/user/user.types';
import UserSessionService from '@/modules/user_session/user_session.service';
import { GetSessionDTO } from '@/modules/user_session/user_session.dto';
import AuthMessages from '../auth.messages';
import AuthService from '../auth.service';

const OTP_BYPASS_PATHS = ['/session/otp-send', '/session/otp-verify', '/session'];

/**
 * Auth middleware factory.
 * Returns an Express middleware that validates the session and enforces role requirements.
 *
 * Usage: AuthMiddleware('USER')
 */
export default function AuthMiddleware(role: string) {
  function assertUserHasRole(user: SafeUser, requiredRole: string): void {
    if (!AuthService.checkIfUserHasRole(user, requiredRole)) {
      throw new AppError(
        AuthMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE,
        403,
        ErrorCode.FORBIDDEN,
      );
    }
  }

  function extractAccessToken(req: Request): string | undefined {
    const tokenFromCookie = req.cookies?.accessToken as string | undefined;
    const tokenFromHeader = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    if (tokenFromCookie && tokenFromHeader) {
      throw new AppError(AuthMessages.TWO_AUTH_SOURCES, 401, ErrorCode.UNAUTHORIZED);
    }

    return tokenFromCookie ?? tokenFromHeader;
  }

  function extractRefreshToken(req: Request): string | undefined {
    return req.cookies?.refreshToken as string | undefined;
  }

  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (role === 'GUEST') {
        return next();
      }

      const accessToken = extractAccessToken(req);

      if (!accessToken) {
        throw new AppError(AuthMessages.USER_NOT_AUTHENTICATED, 401, ErrorCode.UNAUTHORIZED);
      }

      // Re-use already authenticated request
      if (req.user) {
        assertUserHasRole(req.user as SafeUser, role);
        return next();
      }

      const parsed = GetSessionDTO.safeParse({ accessToken });
      if (!parsed.success) {
        throw new AppError(
          AuthMessages.INVALID_REFRESH_TOKEN,
          401,
          ErrorCode.UNAUTHORIZED,
        );
      }

      const { user, userSession } = await UserSessionService.getSessionDangerously(
        parsed.data,
        req,
      );

      req.user = user;
      req.userSession = userSession;

      // Auto-refresh if session is expired and refresh token is available
      const sessionExpired =
        userSession.sessionExpiry && userSession.sessionExpiry.getTime() < Date.now();

      if (sessionExpired) {
        const currentRefreshToken = extractRefreshToken(req);

        if (currentRefreshToken) {
          const {
            userSession: refreshedSession,
            rawAccessToken,
            rawRefreshToken,
          } = await UserSessionService.refreshAccessToken(currentRefreshToken);

          const isProduction = process.env.NODE_ENV === 'production';

          res.cookie('accessToken', rawAccessToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            maxAge: 1000 * 60 * 60 * 24 * 7,
          });

          res.cookie('refreshToken', rawRefreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            maxAge: 1000 * 60 * 60 * 24 * 7,
          });

          req.userSession = refreshedSession;
        }
      }

      // OTP bypass for specific routes
      const sessionToCheck = req.userSession ?? userSession;
      if (!OTP_BYPASS_PATHS.includes(req.path) && sessionToCheck.otpVerifyNeeded) {
        throw new AppError(AuthMessages.OTP_NEEDED, 401, ErrorCode.OTP_REQUIRED);
      }

      assertUserHasRole(user, role);

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
