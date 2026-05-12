import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/modules/common/app-error';
import UserSecurityService from '@/modules/user_security/user_security.service';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userSecurityRouter = Router();

userSecurityRouter.get(
  '/',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const safe = await UserSecurityService.getSafeByUserId(user.userId);
    res.json(safe);
  },
);

userSecurityRouter.get(
  '/otp-methods',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const safe = await UserSecurityService.getSafeByUserId(user.userId);
    res.json({ methods: safe.otpMethods });
  },
);

export default userSecurityRouter;
