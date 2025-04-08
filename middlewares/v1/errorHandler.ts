import { Request, Response, NextFunction } from "express";

// DTOs
import ErrorResponse from "@/dtos/responses/ErrorResponse";

// Constants
const NODE_ENV = process.env.NODE_ENV || 'development';

export default function errorHandler(error: any, request: Request, response: Response, next: NextFunction) : Response<ErrorResponse> {
    // Handle known application errors
    if (error.isOperational) {
        return response.status(error.statusCode || 400).json({
            error: error.message,
        });
    }


    if (NODE_ENV !== 'development') {        
        return response.status(500).json({
            error: "ERROR_BAD_REQUEST",
        });
    }

    // Handle programming or unknown errors
    return response.status(500).json({
        error: error.message,
    });
};
