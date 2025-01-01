/*
    This middleware is used to check if the user is authenticated and has the required role
    If the user is not authenticated, it will return 401
    If the user is authenticated but does not have the required role, it will return 401
    If the user is authenticated and has the required role, it will call the next middleware
    Default required role is 'USER'
*/
import express, { NextFunction, Request, Response } from 'express';

import { User } from '@prisma/client';

import AuthService from '../services/AuthService';

export default function (incomingReqRoles?: string | string[] | undefined) {

    return async function authMiddleware(req: Request, res: Response, next: NextFunction) {


      var requiredRoles = incomingReqRoles ? typeof incomingReqRoles === 'string' ? [incomingReqRoles] : incomingReqRoles : ['USER'];

      //if we have user already in the request, it means we have already checked the user, so it will be elavation of privilages

      if (req.user) {     
        //check if the user has the required role
        if (!AuthService.checkIfUserHasRole(req.user, requiredRoles)) {
          throw new Error("USER_DOES_NOT_HAVE_REQUIRED_ROLE");
        }
        
        return next();
      }
       
      const token = req.headers.authorization;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

      // Allow guest if token is not present
      if (requiredRoles.length === 0 || requiredRoles.includes('GUEST')) {
        return next();
      }

      if (!token) {
        throw new Error("USER_NOT_AUTHENTICATED");
      }

      const sessionWithUser = await AuthService.getSession({ token });

      if (!sessionWithUser) {
        throw new Error("USER_NOT_AUTHENTICATED");
      }

      // Add user to request
      req.user = sessionWithUser.user as User;

      if (!AuthService.checkIfUserHasRole(req.user, requiredRoles)) {
        throw new Error("USER_DOES_NOT_HAVE_REQUIRED_ROLE");
      }
      
      next();
    }
}
