import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import TenantSettingService from '../tenant_setting.service';
import { SetSettingDTO } from '../tenant_setting.dto';

// TODO: import { AuthMiddleware } from '@/modules/auth/router';

const tenantSettingRouter = Router({ mergeParams: true });

/**
 * GET /
 * List all settings for the tenant. Requires ADMIN.
 */
tenantSettingRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const settings = await TenantSettingService.getAll(tenantId, false);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /public
 * List public-only settings. Requires AUTH (no role restriction).
 */
tenantSettingRouter.get(
  '/public',
  // TODO: AuthMiddleware(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const settings = await TenantSettingService.getAll(tenantId, true);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /:key
 * Get a specific setting by key. Requires ADMIN.
 */
tenantSettingRouter.get(
  '/:key',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const { key } = req.params;
      if (!key) {
        throw new AppError('Missing key', 400, ErrorCode.VALIDATION_ERROR);
      }

      const setting = await TenantSettingService.get(tenantId, key);
      if (!setting) {
        throw new AppError('Setting not found', 404, ErrorCode.NOT_FOUND);
      }

      res.json(setting);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /
 * Create or update a setting. Requires ADMIN.
 */
tenantSettingRouter.put(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = SetSettingDTO.safeParse({ ...req.body, tenantId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const setting = await TenantSettingService.set(parsed.data);
      res.json(setting);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:key
 * Delete a setting. Requires ADMIN.
 */
tenantSettingRouter.delete(
  '/:key',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const { key } = req.params;
      if (!key) {
        throw new AppError('Missing key', 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantSettingService.delete(tenantId, key);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantSettingRouter;
