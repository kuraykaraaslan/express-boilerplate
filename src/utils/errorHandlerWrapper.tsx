import { Request, Response, NextFunction } from 'express';
import Logger from '../helpers/Logger';



const errorHandlerWrapper = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
        return await fn(req, res, next);
    } catch (error: any) {

        Logger.error(error.message, req, res);

        res.status(error.code || 500).json({
            error: error.message || "Internal Server Error",
        });
    }
};

export default errorHandlerWrapper;