import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/modules_express/common/app-error';
import UserPreferencesService from '@/modules/user_preferences/user_preferences.service';
import { UpdatePreferencesRequestSchema } from '@/modules/user_preferences/user_preferences.dto';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userPreferencesRouter = Router();

userPreferencesRouter.get(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const prefs = await UserPreferencesService.getByUserId(user.userId);
    res.json(prefs);
  },
);

userPreferencesRouter.put(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const parsed = UpdatePreferencesRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('INVALID_PREFERENCES_DATA', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await UserPreferencesService.update(user.userId, parsed.data);
    res.json(updated);
  },
);

export default userPreferencesRouter;
