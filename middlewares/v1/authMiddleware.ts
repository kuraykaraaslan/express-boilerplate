import { NextFunction, Request, Response } from 'express';
import AuthService from '../../services/v1/AuthService';
import UserSessionService from '../../services/v1/AuthService/UserSessionService';
import { User } from '@prisma/client';
import GetSessionRequest from '../../dtos/requests/auth/GetSessionRequest';
import AuthMessages from '../../dictionaries/AuthMessages';


/**
 * Middleware to check if the user is authenticated and has the required role.
 * @param {string} requiredRole - The role that is required to access the route.
 * @returns {Function} - The middleware function.
 */
export default function (requiredRole: string) {
  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {
      if (requiredRole === 'GUEST') return next();

      const hasCookieToken = Boolean(req.cookies?.accessToken);
      const hasHeaderToken = req.headers.authorization?.startsWith('Bearer ') ?? false;

      if (hasCookieToken && hasHeaderToken) {
        throw new AppError(AuthMessages.TWO_AUTH_SOURCES);
      }


      // ✅ Hangi kaynak varsa onu seç
      const accessToken = hasCookieToken
        ? req.cookies.accessToken
        : hasHeaderToken
        ? req.headers.authorization!.split(' ')[1]
        : undefined;

      const authSource = hasCookieToken ? 'cookie' : hasHeaderToken ? 'header' : 'none';

      if (!accessToken) {
        throw new AppError(AuthMessages.USER_NOT_AUTHENTICATED, 401);
      }

      // Zaten tanımlı user varsa tekrar kontrol etme
      if (req.user) {
        if (!AuthService.checkIfUserHasRole(req.user as User, requiredRole)) {
          throw new AppError(AuthMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE, 403);
        }
        return next();
      }

      const sessionData = new GetSessionRequest({ accessToken });
      const { user, userSession } = await UserSessionService.getSessionDangerously(sessionData, req);

      req.user = user;
      req.userSession = userSession;

      if (userSession.otpNeeded) {
        throw new AppError(AuthMessages.OTP_NEEDED, 401);
      }

      if (!AuthService.checkIfUserHasRole(user, requiredRole)) {
        throw new AppError(AuthMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE, 403);
      }

      return next();     
    
  };
}
