import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/modules/common/app-error';
import UserService from '@/modules/user/user.service';
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  GetAllUsersQuerySchema,
  GetUserByIdSchema,
} from '@/modules/user/user.dto';
import { SafeUser } from '@/modules/user/user.types';

// TODO: import AuthMiddleware from "@/modules/auth/middleware"
function AuthMiddleware(_requiredRole: string) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}

const userRouter = Router();

// ── GET / — list all users (ADMIN) ──────────────────────────────────────────

userRouter.get(
  '/',
  AuthMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    const parsed = GetAllUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('INVALID_QUERY_PARAMETERS', 400, ErrorCode.VALIDATION_ERROR);
    }
    const result = await UserService.getAll({
      ...parsed.data,
      search: parsed.data.search ?? undefined,
      userId: parsed.data.userId ?? undefined,
    });
    res.json(result);
  },
);

// ── GET /me — current user's profile ────────────────────────────────────────

userRouter.get(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const user = req.user as SafeUser | undefined;
    if (!user?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }
    const profile = await UserService.getById(user.userId);
    res.json(profile);
  },
);

// ── GET /:userId — get specific user (ADMIN) ────────────────────────────────

userRouter.get(
  '/:userId',
  AuthMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    const parsed = GetUserByIdSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError('INVALID_USER_ID', 400, ErrorCode.VALIDATION_ERROR);
    }
    const user = await UserService.getById(parsed.data.userId);
    res.json(user);
  },
);

// ── PUT /me — update own profile ────────────────────────────────────────────

userRouter.put(
  '/me',
  AuthMiddleware('USER'),
  async (req: Request, res: Response) => {
    const currentUser = req.user as SafeUser | undefined;
    if (!currentUser?.userId) {
      throw new AppError('UNAUTHORIZED', 401, ErrorCode.UNAUTHORIZED);
    }

    const parsed = UpdateUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('INVALID_USER_DATA', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await UserService.update({ userId: currentUser.userId, data: parsed.data });
    res.json(updated);
  },
);

// ── DELETE /:userId — delete user (ADMIN) ───────────────────────────────────

userRouter.delete(
  '/:userId',
  AuthMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    const parsed = GetUserByIdSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError('INVALID_USER_ID', 400, ErrorCode.VALIDATION_ERROR);
    }
    await UserService.delete(parsed.data.userId);
    res.status(204).send();
  },
);

export default userRouter;
