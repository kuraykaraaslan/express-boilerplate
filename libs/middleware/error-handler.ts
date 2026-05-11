import { Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import { env } from '@/libs/env';

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  // ── CSRF error ────────────────────────────────────────────────────────────
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<string, unknown>)['code'] === 'EBADCSRFTOKEN'
  ) {
    const secure = env.NODE_ENV === 'production';

    response.clearCookie('XSRF-TOKEN', { httpOnly: false, sameSite: 'strict', secure });
    response.clearCookie('_csrf',      { httpOnly: true,  sameSite: 'strict', secure });

    response.status(403).json({ code: ErrorCode.INVALID_CSRF_TOKEN, message: 'Invalid CSRF token' });
    return;
  }

  // ── Operational AppError ──────────────────────────────────────────────────
  if (error instanceof AppError) {
    response.status(error.statusCode).json(error.toJSON());
    return;
  }

  // ── Unknown / programming error ───────────────────────────────────────────
  const err = error instanceof Error ? error : new Error(String(error));

  console.error('[ErrorHandler]', {
    name: err.name,
    message: err.message,
    stack: err.stack,
  });

  const isProd = env.NODE_ENV === 'production';

  response.status(500).json({
    code: ErrorCode.INTERNAL_ERROR,
    message: isProd ? 'An unexpected error occurred' : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
}

export default errorHandler;
