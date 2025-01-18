import { rateLimit } from 'express-rate-limit'
import { Request, Response } from 'express';

export default class Limiter {
	static limiter = rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		max: 2, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
		message: (request: Request, response: Response) => {
			return { error: 'RATE_LIMIT_EXCEEDED' };
		},
		headers: true,
	});

	static useLimiter(request: any, response: any, next: any) {
		Limiter.limiter(request, response, next);
	}
}

