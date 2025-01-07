/*
    This middleware is used to check if the user is authenticated and has the required role
    If the user is not authenticated, it will return 401
    If the user is authenticated but does not have the required role, it will return 401
    If the user is authenticated and has the required role, it will call the next middleware
    Default required role is 'USER'
*/
import express, { NextFunction, Request, Response } from 'express';

import { User, UserSession } from '@prisma/client';

import AuthService from '../services/AuthService';
import OmitPasswordUserResponse from '@/dtos/responses/OmitPasswordUserResponse';
import OmitOTPFieldsUserSessionResponse from '@/dtos/responses/OmitOTPFieldsUserSessionResponse';

export default function (incomingReqRoles?: string | string[] | undefined) {

  return async function authMiddleware(req: Request, res: Response, next: NextFunction) {

    try {

      var requiredRoles = incomingReqRoles ? typeof incomingReqRoles === 'string' ? [incomingReqRoles] : incomingReqRoles : ['USER'];

      //if we have user already in the request, it means we have already checked the user, so it will be elavation of privilages

      if (req.user) {
        //check if the user has the required role
        if (!AuthService.checkIfUserHasRole(req.user, requiredRoles)) {
          throw new Error("USER_DOES_NOT_HAVE_REQUIRED_ROLE");
        }

        return next();
      }

      const token = req.headers?.authorization ? req.headers.authorization.split(' ')[1] : null;

      console.log('token', token);
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

      // Allow guest if token is not present
      if (requiredRoles.length === 0 || requiredRoles.includes('GUEST')) {
        return next();
      }

      if (!token) {
        throw new Error("USER_NOT_AUTHENTICATED");
      }

      const sessionWithUser = await AuthService.getSession({ token }) as { user: OmitPasswordUserResponse, session: OmitOTPFieldsUserSessionResponse };

      if (!sessionWithUser || !sessionWithUser.user || !sessionWithUser.session) {
        throw new Error("USER_NOT_AUTHENTICATED");
      }

      // Add user to request
      req.user = sessionWithUser.user as User;
      req.userSession = sessionWithUser.session as OmitOTPFieldsUserSessionResponse;

      //check if the session is valid
      if (new Date(req.userSession.expiresAt) < new Date()) {
        throw new Error("SESSION_EXPIRED");
      }

      //check if the session needs to OTP verification
      if (req.userSession.otpNeeded) {
        throw new Error("OTP_VERIFICATION_NEEDED");
      }

      //check if the user has the required role

      if (!AuthService.checkIfUserHasRole(req.user, requiredRoles)) {
        throw new Error("USER_DOES_NOT_HAVE_REQUIRED_ROLE");
      }

      next();

    } catch (error: any) {
      res.status(401).send({ error: error.message });
    }
  }
}
