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

      if (!/^Bearer /.test(request.headers.authorization || '')) {
        return response.status(401).json({ error: AuthErrors.USER_NOT_AUTHENTICATED });
      }
      // Extract access token
      const accessToken = request.headers?.authorization ? request.headers.authorization.split(' ')[1] : null;

      console.log('Access token INCOMING: ', accessToken);

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
      const { user, userSession } = await UserSessionService.getSessionDangerously(sessionData, request);

      // Attach user and session
      request.user = user;
      request.userSession = userSession;

      if (request.userSession.otpNeeded) {
        return response.status(403).json({ error: AuthErrors.OTP_NEEDED });
      }

      if (!AuthService.checkIfUserHasRole(request.user, requiredRole)) {
        return response.status(403).json({ error: AuthErrors.USER_DOES_NOT_HAVE_REQUIRED_ROLE });
      }

      return next();

    } catch (error: any) {
      return response.status(500).json({ error: AuthErrors.UNKNOWN_ERROR });
    }
  };
}
