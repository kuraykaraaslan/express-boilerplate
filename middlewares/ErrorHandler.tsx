import ErrorResponse from "../dtos/responses/ErrorResponse";
import { Request, Response, NextFunction, ErrorRequestHandler } from "express";

const NODE_ENV = process.env.NODE_ENV || 'development';

export default function ErrorHandler(error: any, request: Request, response: Response, next: NextFunction) : Response<ErrorResponse> {
    // Handle known application errors
    if (error.isOperational) {
        return response.status(error.statusCode || 400).json({
            error: error.message,
        });
    }

    if (NODE_ENV !== 'development') {
        return response.status(500).json({
            error: "BAD_REQUEST",
        });
    }


    // Handle programming or unknown errors
    return response.status(500).json({
        error: error.message,
    });
};
