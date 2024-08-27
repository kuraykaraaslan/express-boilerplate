import express , { NextFunction } from 'express';
import Response from '../response/Response';
import Request from '../request/Request';
import { User, Session } from '@prisma/client';

import AuthService from '../services/AuthService';
import Logger from '../helpers/Logger';



async function authMiddleware(req: Request, res: Response, next: NextFunction) {

    const NODE_ENV = process.env.NODE_ENV || 'development';
    
    const token = req.headers.authorization;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    //TODO
    const needAuth = req.needAuth || true;
    const needAdmin = req.needAdmin || false;

    // Allow guest if token is not present
    if (!needAuth) {
        Logger.info("[AUTH] Allow guest for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        next();
        return;
    }

    // Check if token is present
    if (!token ||  token.length < 7) {
        Logger.error("[AUTH] Token not present for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        res.status(401).json({ message: "USER_NOT_LOGGED_IN" });
        return;
    }

    // Check if token is valid
    const tokenWithoutBearer = token.substring(7);
    const sessionWithUser = await AuthService.getUserFromTokenAndExtendAday(tokenWithoutBearer);



    // Check if OTP verification is needed
    if (sessionWithUser.OTPNeeded) {
        Logger.error("[AUTH] OTP verification needed for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        res.status(401).json({ message: "OTP_VERIFICATION_NEEDED" });
        return;
    }

    // Add user to request
    const user = sessionWithUser.user;

    if (needAdmin && user.role !== 'SYSTEM_ADMIN') {
        Logger.error("[AUTH] User not system admin for Route: " + req.originalUrl + " from IP: " + ip, req, res);
        res.status(401).json({ message: "USER_NOT_SYSTEM_ADMIN" });
        return;
    }

    req.user = user;

    Logger.info("[AUTH] User authenticated for Route: " + req.originalUrl + " from IP: " + ip, req, res);

    next();
}

export default authMiddleware;


