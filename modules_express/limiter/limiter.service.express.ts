import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '@/modules/env';

const WINDOW_MS      = env.RATE_LIMIT_WINDOW_MS;
const MAX            = Math.max(1, env.RATE_LIMIT_MAX);
const AUTH_WINDOW_MS = env.RATE_LIMIT_AUTH_WINDOW_MS;
const AUTH_MAX       = Math.max(1, env.RATE_LIMIT_AUTH_MAX);

function getIp(request: Request): string {
  return (
    request.headers['x-real-ip']?.toString() ??
    request.headers['x-forwarded-for']?.toString() ??
    request.socket.remoteAddress?.toString() ??
    'default-ip'
  );
}

export class Limiter {
  static readonly limiter: RateLimitRequestHandler = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
    },
    headers: true,
    keyGenerator: getIp,
  });

  static readonly authLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: AUTH_WINDOW_MS,
    max: AUTH_MAX,
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: 'RATE_LIMIT_EXCEEDED' });
    },
    headers: true,
    keyGenerator: getIp,
  });

  static useLimiter(request: Request, response: Response, next: () => void): void {
    Limiter.limiter(request, response, next);
  }

  static useAuthLimiter(request: Request, response: Response, next: () => void): void {
    Limiter.authLimiter(request, response, next);
  }
}

export default Limiter;
