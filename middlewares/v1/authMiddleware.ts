import { NextFunction, Request, Response } from 'express';

// Services
import AuthService from '../../services/v1/AuthService';

// Models
import { User } from '@prisma/client';

// DTOs
import GetSessionRequest from '../../dtos/requests/auth/GetSessionRequest';

export default function (requiredRole: string) {


  return async function authMiddleware(request: Request<any>, response: Response<any>, next: NextFunction) {

    try {

      //if we have user already in the request, it means we have already checked the user, so it will be elavation of privilages

      if (request.user! as User) {
        
        //check if the user has the required role
        if (!AuthService.checkIfUserHasRole(request.user!, requiredRole)) {
          throw new Error("USER_DOES_NOT_HAVE_REQUIRED_ROLE");
        }

        return next();
      }

      const accessToken = request.headers?.authorization ? request.headers.authorization.split(' ')[1] : null;

      // Allow guest if token is not present
      if (requiredRole === 'GUEST') {
        return next();
      }

      if (!accessToken) {
        throw new Error("USER_NOT_AUTHENTICATED");
      }

      const sessionData = new GetSessionRequest({ accessToken });

      const sessionWithUser = await AuthService.getSession(sessionData);

      if (!sessionWithUser || !sessionWithUser.user || !sessionWithUser.userSession) {
        throw new Error("USER_NOT_AUTHENTICATED");
      }

      // Add user to request
      request.user = sessionWithUser.user;
      request.userSession = sessionWithUser.userSession;

      if (!request.user) {
        throw new Error("USER_NOT_FOUND");
      }

      if (!request.userSession) {
        throw new Error("USER_SESSION_NOT_FOUND");
      }

      //check if the session needs to OTP verification
      if (request.userSession.otpNeeded) {
        throw new Error("OTP_VERIFICATION_NEEDED");
      }

      //check if the user has the required role

      if (!AuthService.checkIfUserHasRole(request.user, requiredRole)) {
        throw new Error("USER_DOES_NOT_HAVE_REQUIRED_ROLE");
      }


      const originalJson = response.json;

      // @ts-ignore

      /*
      response.json = function (body) {
        if (body && typeof body === 'object') {
          return AuthService.refreshAccessToken(accessToken).then(refreshedSession => {
            body.userSession = refreshedSession;
            return originalJson.call(this, body);
          }).catch(() => {
            return originalJson.call(this, body);
          });
        } else {
          return originalJson.call(this, body);
        }
      };
      */

      return next();

    } catch (error: any) {
      throw new Error(error.message);
    }
  }
}
