/**
 * User Security Router
 *
 * Provides endpoints for managing user account security settings.
 * Auth middleware is a placeholder until @/modules/auth is available.
 *
 * Mount this router at /user-security (e.g. app.use('/user-security', userSecurityRouter)).
 */
import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/libs/app-error';
import UserSecurityService from '../user_security.service';
import { SafeUserSecurity } from '../user_security.types';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
// Placeholder until the auth module is available
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userSecurityRouter = Router();

// ── GET / — own security settings ───────────────────────────────────────────

userSecurityRouter.get(
  '/',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const security = await UserSecurityService.findOrCreate(user.userId);
    const safe: SafeUserSecurity = UserSecurityService.omitSensitiveFields(security);
    res.json(safe);
  },
);

// ── GET /otp-methods — active OTP methods ───────────────────────────────────

userSecurityRouter.get(
  '/otp-methods',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const methods = await UserSecurityService.getOTPMethods(user.userId);
    res.json({ methods });
  },
);

export default userSecurityRouter;
