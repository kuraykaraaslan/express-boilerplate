import { NextFunction, Request, Response } from 'express';

// Services
import AuthService from '../../services/v1/AuthService';
import UserSessionService from '../../services/v1/AuthService/UserSessionService';

// Models
import { User } from '@prisma/client';

// DTOs
import GetSessionRequest from '../../dtos/requests/auth/GetSessionRequest';
import AuthErrors from '../../errors/AuthErrors';


export default function (requiredRole: string) {
  return async function authMiddleware(request: Request<any>, response: Response<any>, next: NextFunction) {
    try {
      // Allow guest if role is GUEST immediately
      if (requiredRole === 'GUEST') {
        return next();
      }

      // Extract access token
      const accessToken = request.headers?.authorization ? request.headers.authorization.split(' ')[1] : null;

      console.log('Access token:', accessToken);

      if (!accessToken) {
        throw new Error(AuthErrors.USER_NOT_AUTHENTICATED);
      }

      // If user already set by a previous middleware
      if (request.user) {
        if (!AuthService.checkIfUserHasRole(request.user as User, requiredRole)) {
          return response.status(403).json({ error: AuthErrors.USER_DOES_NOT_HAVE_REQUIRED_ROLE });
        }
        return next();
      }

      // Otherwise validate session
      const sessionData = new GetSessionRequest({ accessToken });

      console.log('Session data:', sessionData);
    
      const deviceFingerprint = await UserSessionService.generateDeviceFingerprint(request);

      console.log('Device fingerprint:', deviceFingerprint);
      const sessionWithUser = await UserSessionService.getSession(sessionData, deviceFingerprint);

      if (!sessionWithUser || !sessionWithUser.user || !sessionWithUser.userSession) {
        throw new Error(AuthErrors.SESSION_NOT_FOUND);
      }

      console.log('Session with user:', sessionWithUser);

      // Attach user and session
      request.user = sessionWithUser.user;
      request.userSession = sessionWithUser.userSession;

      console.log('User session:', request.userSession);
      console.log('User:', request.user);

      if (request.userSession.otpNeeded) {
        return response.status(403).json({ error: AuthErrors.OTP_NEEDED });
      }

      if (!AuthService.checkIfUserHasRole(request.user, requiredRole)) {
        return response.status(403).json({ error: AuthErrors.USER_DOES_NOT_HAVE_REQUIRED_ROLE });
      }

      const timeLeft = request.userSession.sessionExpiry.getTime() - new Date().getTime();

      if (timeLeft < 300000) { // 300 saniye = 5 dakika

        const refreshedSession = await UserSessionService.refreshAccessToken(request.userSession.refreshToken);

        if (refreshedSession) {
          response.setHeader('x-new-access-token', refreshedSession.accessToken);
        }
      }

      return next();

    } catch (error: any) {
      return response.status(500).json({ error: AuthErrors.UNKNOWN_ERROR });
    }
  };
}
