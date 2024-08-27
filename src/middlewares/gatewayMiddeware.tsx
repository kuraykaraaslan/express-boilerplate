import express, { NextFunction } from 'express';

import Request from '../request/Request';
import Response from '../response/Response';
import Logger from '../helpers/Logger';

async function gatewayMiddleware(req: Request, res: Response, next: NextFunction) {

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const path = req.originalUrl;
    const method = req.method;
    const userAgent = req.headers['user-agent'] || "Unknown";

    //CREATE RANDOM STRING REQUEST ID
    const requestId = Math.random().toString(36).substring(7);
    req.requestId = requestId;

    Logger.connect(req, res);
    next();
}

export default gatewayMiddleware;



