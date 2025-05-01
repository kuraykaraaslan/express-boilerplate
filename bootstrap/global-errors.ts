// src/bootstrap/global-errors.ts

// @ts-nocheck OR cast with `as any` below if needed

if (!global.AppError) {
  global.AppError = class AppError extends Error {
    public statusCode: number;
    public isOperational: boolean;

    constructor(message: string, statusCode: number = 400) {
      let finalMessage = message;
      let finalStatusCode = statusCode;

      if (message.includes(':')) {
        const [msg, code] = message.split(':');
        finalMessage = msg;
        finalStatusCode = parseInt(code);
      }

      super(finalMessage);
      this.statusCode = finalStatusCode;
      this.isOperational = true;

      Object.setPrototypeOf(this, new.target.prototype);
      Error.captureStackTrace(this, this.constructor);
    }
  };
}
