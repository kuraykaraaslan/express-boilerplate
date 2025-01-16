import ErrorResponse from "@/dtos/responses/ErrorResponse";
import { Request, Response, NextFunction, ErrorRequestHandler } from "express";

export default function ErrorHandler(err: any, req: Request, res: Response, next: NextFunction) : Response<ErrorResponse> {
    //console.log(err);
    console.error(err.message);
    // Handle known application errors
    if (err.isOperational) {
        return res.status(err.statusCode || 400).json({
            error: err.message,
        });
    }

    // Handle programming or unknown errors
    return res.status(500).json({
        error: err.message,
    });
};
