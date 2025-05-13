import { NextFunction, Request, Response } from 'express';
import AuthService from '../services';
import UserSessionService from '../services/UserSessionService';
import { GetSessionRequest } from '../dto/requests/GetSessionRequest';
import AuthMessages from '../dictionaries';
import { SafeUser } from '../../user/types/SafeUser';

const OTP_BYPASS_PATHS = ['/session/otp-send', '/session/otp-verify', '/session'];

/**
 * Middleware to check if the user is authenticated and has the required role.
 * @param {string} requiredRole - The role that is required to access the route.
 * @returns {Function} - The middleware function.
 */
export default function (requiredRole: string) {

  function assertUserHasRole(user: SafeUser, role: string) {
    if (!AuthService.checkIfUserHasRole(user, role)) {
      throw new AppError(AuthMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE, 403);
    }
  };

  function extractAccessToken(req: Request, raiseError = true): string | undefined {
    const tokenFromCookie = req.cookies?.accessToken;
    const tokenFromHeader = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    if (tokenFromCookie && tokenFromHeader) {
      throw new AppError(AuthMessages.TWO_AUTH_SOURCES);
    }

    return tokenFromCookie || tokenFromHeader;
  }

  function extractRefreshToken(req: Request, raiseError = false): string | undefined {
    const tokenFromCookie = req.cookies?.refreshToken;

    if (!tokenFromCookie) {
      if (raiseError) throw new AppError(AuthMessages.REFRESH_TOKEN_NOT_FOUND, 401);
    }

    return tokenFromCookie;
  }

  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    if (requiredRole === 'GUEST') return next();

    // ✅ Hangi kaynak varsa onu seç
    const accessToken = extractAccessToken(req);

    if (!accessToken) {
      throw new AppError(AuthMessages.USER_NOT_AUTHENTICATED, 401);
    }

    // Zaten tanımlı user varsa tekrar kontrol etme
    if (req.user) {
      assertUserHasRole(req.user as SafeUser, requiredRole);
      return next();
    }

    const parsedSession = GetSessionRequest.safeParse({
      accessToken,
    });

    if (!parsedSession.success) {
      throw new AppError(AuthMessages.INVALID_REFRESH_TOKEN, 401);
    }

    console.log('parsedSession', parsedSession);

    const { user, userSession } = await UserSessionService.getSessionDangerously(parsedSession.data, req);

    req.user = user;
    req.userSession = userSession;

    const sessionExpiry = userSession.sessionExpiry;
    const currentTime = new Date();


    const sessionExpired = sessionExpiry && sessionExpiry.getTime() < currentTime.getTime();

    console.log('sessionExpired', sessionExpired);

    if (sessionExpired) {

      const currentRefreshToken = extractRefreshToken(req);

      console.log('currentRefreshToken', currentRefreshToken);

      if (currentRefreshToken) {

        const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionService.refreshAccessToken(currentRefreshToken);

        // Set the new access token as a cookie
        res.cookie('accessToken', rawAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production', // Set to true in production
          sameSite: 'strict',
          maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        });
        // Set the new refresh token as a cookie
        res.cookie('refreshToken', rawRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production', // Set to true in production
          sameSite: 'strict',
          maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        });
        req.userSession = userSession;
      }
    }

    //eğer path /session/otp-send ve /session/otp-verify değilse
    if (!OTP_BYPASS_PATHS.includes(req.path)) {
      if (userSession.otpVerifyNeeded) {
        throw new AppError(AuthMessages.OTP_NEEDED, 401);
      }
    }

    assertUserHasRole(user, requiredRole);

    return next();

  };
}
