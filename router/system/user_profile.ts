import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/modules/common/app-error';
import UserProfileService from '@/modules/user_profile/user_profile.service';
import { UpdateProfileRequestSchema } from '@/modules/user_profile/user_profile.dto';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userProfileRouter = Router();

userProfileRouter.get(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const profile = await UserProfileService.getByUserId(user.userId);
    res.json(profile);
  },
);

userProfileRouter.put(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const parsed = UpdateProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('INVALID_PROFILE_DATA', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await UserProfileService.update(user.userId, parsed.data);
    res.json(updated);
  },
);

export default userProfileRouter;
