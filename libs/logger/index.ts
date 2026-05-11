import { Request, Response, NextFunction } from 'express';
import winston from 'winston';
import { env } from '@/libs/env';

const { combine, timestamp, json, printf } = winston.format;
const timestampFormat = 'MMM-DD-YYYY HH:mm:ss';

const isDev = env.NODE_ENV === 'development';

function makeTransports(level: string): winston.transport[] {
  if (isDev) {
    return [new winston.transports.Console()];
  }
  return [
    new winston.transports.File({
      filename: 'logs/' + new Date().toISOString().split('T')[0] + '.log',
      level,
    }),
  ];
}

function makeLogger(level: string): winston.Logger {
  return winston.createLogger({
    level,
    format: combine(
      timestamp({ format: timestampFormat }),
      json(),
      printf(({ level: lvl, message, timestamp: ts }) => {
        return `[${ts}] [${lvl}]: ${message}`;
      }),
    ),
    transports: makeTransports(level),
  });
}

export class Logger {
  private static infoLogger  = makeLogger('info');
  private static errorLogger = makeLogger('error');
  private static warnLogger  = makeLogger('warn');

  private static serialize(...args: unknown[]): string {
    return args
      .map(a => (typeof a === 'object' && a !== null) ? JSON.stringify(a) : String(a))
      .join(' ');
  }

  static info(message: string, ...args: unknown[]): void {
    const msg = args.length > 0 ? `${message} ${Logger.serialize(...args)}` : message;
    Logger.infoLogger.info(msg);
  }

  static error(message: string, ...args: unknown[]): void {
    const msg = args.length > 0 ? `${message} ${Logger.serialize(...args)}` : message;
    Logger.errorLogger.error(msg);
  }

  static warn(message: string, ...args: unknown[]): void {
    const msg = args.length > 0 ? `${message} ${Logger.serialize(...args)}` : message;
    Logger.warnLogger.warn(msg);
  }

  static debug(message: string, ...args: unknown[]): void {
    const msg = args.length > 0
      ? `[DEBUG] ${message} ${Logger.serialize(...args)}`
      : `[DEBUG] ${message}`;
    Logger.infoLogger.info(msg);
  }

  static useLogger(request: Request, response: Response, next: NextFunction): void {
    const ip =
      request.headers['x-forwarded-for']?.toString() ||
      request.socket.remoteAddress ||
      'unknown';
    const method = request.method;
    const url = request.url;

    response.on('finish', () => {
      const status = response.statusCode;
      const message = `${method} ${url.split('?')[0]} ${status} ${ip} ${response.statusMessage}`;

      if (status >= 400) {
        Logger.error(message);
      } else {
        Logger.info(message);
      }
    });

    next();
  }
}

export default Logger;
