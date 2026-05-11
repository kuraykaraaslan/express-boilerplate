/**
 * User Router
 *
 * Provides endpoints for managing users. Admin-only routes are protected with
 * the auth middleware once @/modules/auth is available.
 *
 * Mount this router at /users (e.g. app.use('/users', userRouter)).
 */
import { Router, Request, Response, NextFunction } from 'express';

import { AppError, ErrorCode } from '@/libs/app-error';
import UserService from '../user.service';
import {
  CreateUserDTO,
  UpdateUserDTO,
  GetUsersDTO,
  UserIdDTO,
} from '../user.dto';
import { SafeUser } from '../user.types';

// TODO: import AuthMiddleware from "@/modules/auth/router"
// Placeholder until the auth module is migrated to modules/auth/
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
    const parsed = GetUsersDTO.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('INVALID_QUERY_PARAMETERS', 400, ErrorCode.VALIDATION_ERROR);
    }
    const result = await UserService.list(parsed.data);
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
    const profile = await UserService.findById(user.userId);
    res.json(profile);
  },
);

// ── GET /:userId — get specific user (ADMIN) ────────────────────────────────

userRouter.get(
  '/:userId',
  AuthMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    const parsed = UserIdDTO.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError('INVALID_USER_ID', 400, ErrorCode.VALIDATION_ERROR);
    }
    const user = await UserService.findById(parsed.data.userId);
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

    const parsed = UpdateUserDTO.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('INVALID_USER_DATA', 400, ErrorCode.VALIDATION_ERROR);
    }

    const updated = await UserService.update(currentUser.userId, parsed.data);
    res.json(updated);
  },
);

// ── DELETE /:userId — delete user (ADMIN) ───────────────────────────────────

userRouter.delete(
  '/:userId',
  AuthMiddleware('ADMIN'),
  async (req: Request, res: Response) => {
    const parsed = UserIdDTO.safeParse(req.params);
    if (!parsed.success) {
      throw new AppError('INVALID_USER_ID', 400, ErrorCode.VALIDATION_ERROR);
    }
    await UserService.delete(parsed.data.userId);
    res.status(204).send();
  },
);

export default userRouter;
