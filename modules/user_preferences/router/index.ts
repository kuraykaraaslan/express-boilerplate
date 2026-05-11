/**
 * User Preferences Router
 *
 * Provides endpoints for managing user preferences (language, theme, notifications, etc.).
 * Auth middleware is a placeholder until @/modules/auth is available.
 *
 * Mount this router at /user-preferences (e.g. app.use('/user-preferences', userPreferencesRouter)).
 */
import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/libs/app-error';
import UserPreferencesService from '../user_preferences.service';
import { UpdateUserPreferencesDTO } from '../user_preferences.dto';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
// Placeholder until the auth module is available
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userPreferencesRouter = Router();

// ── GET /me — own preferences ────────────────────────────────────────────────

userPreferencesRouter.get(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const prefs = await UserPreferencesService.findByUserId(user.userId);
    res.json(prefs);
  },
);

// ── PUT /me — update own preferences ────────────────────────────────────────

userPreferencesRouter.put(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const parsed = UpdateUserPreferencesDTO.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('INVALID_PREFERENCES_DATA', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await UserPreferencesService.update(user.userId, parsed.data);
    res.json(updated);
  },
);

export default userPreferencesRouter;
