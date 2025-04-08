import { rateLimit } from 'express-rate-limit'
import { Request, Response } from 'express';

const RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX ?? 100;

class Limiter {
	public static readonly limiter = rateLimit({
		windowMs: Number(RATE_LIMIT_WINDOW_MS),
		handler: (request, response, next, options) => {
		
		response.status(options.statusCode).send(options.message)
		},		
		message: (request: Request, response: Response) => {
			return { error: 'RATE_LIMIT_EXCEEDED' };
		},
		headers: true,
		keyGenerator: function (request: Request): string {
			const ip =
				request.headers["x-real-ip"]?.toString() ??
				request.headers["x-forwarded-for"]?.toString() ??
				request.socket.remoteAddress?.toString() ??
				"default-ip";
			return ip;
		}

	});

	public static readonly authLimiter = rateLimit({
		windowMs: Number(0),
		handler: (request, response, next, options) => {
		
			response.status(options.statusCode).send(options.message)
			},			
		message: (request: Request, response: Response) => {
			return { error: 'RATE_LIMIT_EXCEEDED_AUTH' };
		},
		headers: true,
		keyGenerator: function (request: Request): string {
			const ip =
				request.headers["x-real-ip"]?.toString() ??
				request.headers["x-forwarded-for"]?.toString() ??
				request.socket.remoteAddress?.toString() ??
				"default-ip";
			return ip;
		}
	

	});


	static useLimiter(request: any, response: any, next: any) {
		Limiter.limiter(request, response, next);
	}

	static useAuthLimiter(request: any, response: any, next: any) {
		Limiter.authLimiter(request, response, next);
	}
}


export default Limiter;