import express , { NextFunction } from 'express';
import Response from '../response/Response';
import Request from '../request/Request';
import { User, Session } from '@prisma/client';

import AuthService from '../services/AuthService';
import Logger from '../helpers/Logger';

interface authMiddlewareArgs {
    requriedRoles?: string[];
    needAuth?: boolean;
}

const defaultArgs: authMiddlewareArgs = {
    requriedRoles: ["USER"],
    needAuth: true
}

async function authMiddleware(req: Request, res: Response, next: NextFunction, args?: authMiddlewareArgs) {


    const NODE_ENV = process.env.NODE_ENV || 'development';
    
    const token = req.headers.authorization;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    args = { ...defaultArgs, ...args };
    
    // Allow guest if token is not present
    if (!args.needAuth) {
        Logger.info("[AUTH] Allow guest for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        next();
        return;
    }

    const sessionWithUser = await AuthService.getSessionFromBearerToken(token as string);

    if (!sessionWithUser) {
        Logger.error("[AUTH] User not authenticated for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        res.status(401).json({ message: "USER_NOT_AUTHENTICATED" });
        return;
    }

    // Check if OTP verification is needed
    if (sessionWithUser.OTPNeeded) {
        Logger.error("[AUTH] OTP verification needed for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        res.status(401).json({ message: "OTP_VERIFICATION_NEEDED" });
        return;
    }

    // Add user to request
    const user = sessionWithUser.user;

    //check for required roles

    if (!args.requriedRoles) {
        args.requriedRoles = ["USER"];
    }

    args.requriedRoles.forEach(role => {
        if (user.role !== role) {
            Logger.error("[AUTH] User not authorized for Route: " + req.originalUrl + " from IP: " + ip, req, res);
            res.status(401).json({ message: "USER_NOT_AUTHORIZED" });
            return;
        }
    } );


    req.user = user;

    Logger.info("[AUTH] User authenticated for Route: " + req.originalUrl + " from IP: " + ip, req, res);

    next();
}

export default authMiddleware;


