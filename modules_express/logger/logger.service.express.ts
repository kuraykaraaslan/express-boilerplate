import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import BaseLogger from '@/modules/logger';

const morganMiddleware = morgan('combined');

export class Logger {
  static info = BaseLogger.info.bind(BaseLogger);
  static error = BaseLogger.error.bind(BaseLogger);
  static warn = BaseLogger.warn.bind(BaseLogger);
  static debug = BaseLogger.debug.bind(BaseLogger);

  static useLogger(req: Request, res: Response, next: NextFunction): void {
    morganMiddleware(req, res, next);
  }
}

export default Logger;
