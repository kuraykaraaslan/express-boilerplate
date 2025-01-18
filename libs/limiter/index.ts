import { rateLimit } from 'express-rate-limit'
import { Request, Response } from 'express';

const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000;
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || 2;

export default class Limiter {
	static limiter = rateLimit({
		windowMs: Number(RATE_LIMIT_WINDOW_MS),
		max: Number(RATE_LIMIT_MAX),
		message: (request: Request, response: Response) => {
			return { error: 'RATE_LIMIT_EXCEEDED' };
		},
		headers: true,
	});

	static useLimiter(request: any, response: any, next: any) {
		Limiter.limiter(request, response, next);
	}
}

