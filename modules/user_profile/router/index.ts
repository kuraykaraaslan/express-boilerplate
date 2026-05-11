/**
 * User Profile Router
 *
 * Provides endpoints for managing user profile data.
 * Auth middleware is a placeholder until @/modules/auth is available.
 *
 * Mount this router at /user-profile (e.g. app.use('/user-profile', userProfileRouter)).
 */
import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/libs/app-error';
import UserProfileService from '../user_profile.service';
import { UpdateUserProfileDTO } from '../user_profile.dto';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
// Placeholder until the auth module is available
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userProfileRouter = Router();

// ── GET /me — own profile ────────────────────────────────────────────────────

userProfileRouter.get(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const profile = await UserProfileService.findByUserId(user.userId);
    res.json(profile);
  },
);

// ── PUT /me — update own profile ─────────────────────────────────────────────

userProfileRouter.put(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const parsed = UpdateUserProfileDTO.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('INVALID_PROFILE_DATA', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await UserProfileService.update(user.userId, parsed.data);
    res.json(updated);
  },
);

export default userProfileRouter;
