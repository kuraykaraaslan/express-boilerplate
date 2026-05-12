import { NextFunction, Request, Response } from 'express';
import { AppError, ErrorCode } from '@/modules_express/common/app-error';
import { SafeUser } from '@/modules/user/user.types';
import AuthMessages from '@/modules/auth/auth.messages';
import AuthService from '@/modules/auth/auth.service';
import UserSessionService from '@/modules/user_session/user_session.service';
import UserSessionExpressService from '@/modules_express/user_session/user_session.service.express';

const OTP_BYPASS_PATHS = ['/session/otp-send', '/session/otp-verify', '/session'];

export default function AuthMiddleware(role: string) {
  function assertUserHasRole(user: SafeUser, requiredRole: string): void {
    if (!AuthService.checkIfUserHasRole(user, requiredRole)) {
      throw new AppError(AuthMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE, 403, ErrorCode.FORBIDDEN);
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

  return async function authMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (role === 'GUEST') return next();

      if (req.user) {
        assertUserHasRole(req.user as SafeUser, role);
        return next();
      }

      const accessToken = extractAccessToken(req);

      if (!accessToken) {
        throw new AppError(AuthMessages.USER_NOT_AUTHENTICATED, 401, ErrorCode.UNAUTHORIZED);
      }

      const { user, userSession } = await UserSessionExpressService.getSession({
        accessToken,
        request: req,
      });

      req.user = user;
      req.userSession = userSession;

      // Auto-refresh if session is expired and refresh token is available
      const sessionExpired =
        userSession.sessionExpiry && userSession.sessionExpiry.getTime() < Date.now();

      if (sessionExpired) {
        const refreshToken = req.cookies?.refreshToken as string | undefined;

        if (refreshToken) {
          const { userSession: refreshedSession, rawAccessToken, rawRefreshToken } =
            await UserSessionService.refreshTokens(refreshToken);

          const isProduction = process.env.NODE_ENV === 'production';
          const cookieOptions = {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict' as const,
            maxAge: 1000 * 60 * 60 * 24 * 7,
          };

          res.cookie('accessToken', rawAccessToken, cookieOptions);
          res.cookie('refreshToken', rawRefreshToken, cookieOptions);
          req.userSession = refreshedSession;
        }
      }

      // OTP check
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
