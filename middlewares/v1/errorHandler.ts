import { Request, Response, NextFunction } from "express";

const NODE_ENV = process.env.NODE_ENV || "development";

export default function errorHandler(
  error: any,
  request: Request,
  response: Response,
  next: NextFunction
) {
  const isAppError = error.isOperational && typeof error.statusCode === "number";

  console.error("[Error Handler]", {
    name: error.name,
    message: error.message,
    statusCode: error.statusCode,
    isOperational: error.isOperational,
    stack: error.stack,
  });

  if (isAppError) {
    return response.status(error.statusCode).json({
      error: error.message,
    });
  }

  return response.status(500).json({
    error: NODE_ENV === "production" ? "ERROR_BAD_REQUEST" : error.message,
    stack: NODE_ENV === "production" ? undefined : error.stack,
  });
}
