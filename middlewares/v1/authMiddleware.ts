import { NextFunction, Request, Response } from 'express';
import AuthService from '../../services/v1/AuthService';
import UserSessionService from '../../services/v1/AuthService/UserSessionService';
import GetSessionRequest from '../../dtos/requests/auth/GetSessionRequest';
import AuthMessages from '../../dictionaries/AuthMessages';
import SafeUser from '../../types/SafeUser';

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

  function extractAccessToken(req: Request): string | undefined {
    const tokenFromCookie = req.cookies?.accessToken;
    const tokenFromHeader = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  
    if (tokenFromCookie && tokenFromHeader) {
      throw new AppError(AuthMessages.TWO_AUTH_SOURCES);
    }
  
    return tokenFromCookie || tokenFromHeader;
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

    const sessionData = new GetSessionRequest({ accessToken });
    const { user, userSession } = await UserSessionService.getSessionDangerously(sessionData, req);

    req.user = user;
    req.userSession = userSession;

    const sessionExpiry = userSession.sessionExpiry;
    const currentTime = new Date();
    
    // Eğer oturum süresi 1 günden az kaldıysa, oturumu yenile
    if (sessionExpiry && sessionExpiry.getTime() - currentTime.getTime() < 24 * 60 * 60 * 1000) {
      const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionService.refreshAccessToken(accessToken);

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
