import { rateLimit } from 'express-rate-limit'
import { Request, Response } from 'express';

const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || 100;

export default class Limiter {
	static limiter = rateLimit({
		windowMs: Number(RATE_LIMIT_WINDOW_MS),
		max: Number(RATE_LIMIT_MAX),
		message: (request: Request, response: Response) => {
			return { error: 'RATE_LIMIT_EXCEEDED' };
		},
		headers: true,
		keyGenerator: function (request: Request) {
			const ip = request.headers["x-real-ip"] || request.headers["x-forwarded-for"] || request.connection.remoteAddress;
			return Array.isArray(ip) ? ip[0] : (ip || 'default-ip');
		}

	});

	static authLimiter = rateLimit({
		windowMs: Number(RATE_LIMIT_WINDOW_MS),
		max: 10,
		message: (request: Request, response: Response) => {
			return { error: 'RATE_LIMIT_EXCEEDED_AUTH' };
		},
		headers: true,
		keyGenerator: function (request: Request) {
			const ip = request.headers["x-real-ip"] || request.headers["x-forwarded-for"] || request.connection.remoteAddress;
			return Array.isArray(ip) ? ip[0] : (ip || 'default-ip');
		}

	});


	static useLimiter(request: any, response: any, next: any) {
		Limiter.limiter(request, response, next);
	}

	static useAuthLimiter(request: any, response: any, next: any) {
		Limiter.authLimiter(request, response, next);
	}
}

