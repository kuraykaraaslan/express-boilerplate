/*
    This middleware is used to check if the user is authenticated and has the required role
    If the user is not authenticated, it will return 401
    If the user is authenticated but does not have the required role, it will return 401
    If the user is authenticated and has the required role, it will call the next middleware
    Default required role is 'USER'
*/
import express, { NextFunction } from 'express';
import Response from '../response/Response';
import Request from '../request/Request';
import Logger from '../helpers/Logger';
import { User } from '../libs/prisma';

import AuthService from '../services/AuthService';
import errorHandlerWrapper from '../utils/errorHandlerWrapper';

const authMiddleware = function (incomingReqRoles?: string | string[] | undefined) {

  return errorHandlerWrapper(

    async function authMiddleware(req: Request, res: Response, next: NextFunction) {

      var requiredRoles = incomingReqRoles ? typeof incomingReqRoles === 'string' ? [incomingReqRoles] : incomingReqRoles : ['USER'];

      //if we have user already in the request, it means we have already checked the user, so it will be elavation of privilages

      if (req.user) {     
        //check if the user has the required role
        if (!AuthService.checkIfUserHasRole(req.user, requiredRoles)) {
          Logger.error("[AUTH] User does not have required role for Route: " + req.originalUrl, req, res);
          return res.status(401).json({ message: "USER_DOES_NOT_HAVE_REQUIRED_ROLE" });
        }
        
        Logger.info("[AUTH] [ELEVATION OF PRIVILAGES] User authenticated for Route: " + req.originalUrl, req, res);
        return next();
      }
       
      const token = req.headers.authorization;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

      // Allow guest if token is not present
      if (requiredRoles.length === 0 || requiredRoles.includes('GUEST')) {
        Logger.info("[AUTH] Guest allowed for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        return next();
      }

      const sessionWithUser = await AuthService.getSessionFromBearerToken(token as string);

      if (!sessionWithUser) {
        Logger.error("[AUTH] User not authenticated for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        return res.status(401).json({ message: "USER_NOT_AUTHENTICATED" });
      }

      // Check if OTP verification is needed
      if (sessionWithUser.OTPNeeded) {
        Logger.error("[AUTH] OTP verification needed for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        return res.status(401).json({ message: "OTP_VERIFICATION_NEEDED" });
      }

      // Add user to request
      req.user = sessionWithUser.user as User;

      if (!AuthService.checkIfUserHasRole(req.user, requiredRoles)) {
        Logger.error("[AUTH] User does not have required role for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        return res.status(401).json({ message: "USER_DOES_NOT_HAVE_REQUIRED_ROLE" });
      }
      

      Logger.info("[AUTH] User authenticated for Route: " + req.originalUrl + " from IP: " + ip, req, res);

      next();
    }
  );
}

export default authMiddleware;