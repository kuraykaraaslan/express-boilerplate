import { Request, Response, NextFunction } from "express";

const NODE_ENV = process.env.NODE_ENV || "development";

export default function errorHandler(
  error: any,
  request: any,
  response: any,
  next: NextFunction
) {
  const isAppError = error.isOperational && typeof error.statusCode === "number";

  
  if (error.code === "EBADCSRFTOKEN") {
    // CSRF hatası durumunda XSRF cookie'lerini temizle
    response.clearCookie("XSRF-TOKEN", {
      httpOnly: false,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });

    response.clearCookie("_csrf", {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production"
    });

    return response.status(403).json({
      error: "INVALID_CSRF_TOKEN",
    });
  }

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
