import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import TenantSettingService from '@/modules/tenant_setting/tenant_setting.service';

// TODO: import { AuthMiddleware } from '@/modules_express/auth/middleware';

const tenantSettingRouter = Router({ mergeParams: true });

tenantSettingRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const settings = await TenantSettingService.getAll(tenantId);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  },
);

tenantSettingRouter.get(
  '/public',
  // TODO: AuthMiddleware(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      // TODO: public/private filtering not available in TenantSettingService.getAll; returning all settings
      const settings = await TenantSettingService.getAll(tenantId);
      res.json(settings);
    } catch (err) {
      next(err);
    }
  },
);

tenantSettingRouter.get(
  '/:key',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const { key } = req.params;
      if (!key) {
        throw new AppError('Missing key', 400, ErrorCode.VALIDATION_ERROR);
      }

      const setting = await TenantSettingService.getByKey(tenantId, key);
      if (!setting) {
        throw new AppError('Setting not found', 404, ErrorCode.NOT_FOUND);
      }

      res.json(setting);
    } catch (err) {
      next(err);
    }
  },
);

tenantSettingRouter.put(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const { key, value, group, type } = req.body as {
        key?: string;
        value?: string;
        group?: string;
        type?: string;
      };

      if (!key || value === undefined) {
        throw new AppError('key and value are required', 400, ErrorCode.VALIDATION_ERROR);
      }

      const setting = await TenantSettingService.create(tenantId, key, String(value), group, type);
      res.json(setting);
    } catch (err) {
      next(err);
    }
  },
);

tenantSettingRouter.delete(
  '/:key',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
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
