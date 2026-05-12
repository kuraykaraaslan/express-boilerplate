import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import TenantService from '@/modules/tenant/tenant.service';
import {
  CreateTenantDTO,
  UpdateTenantDTO,
  GetTenantsDTO,
  GetTenantDTO,
} from '@/modules/tenant/tenant.dto';
import { SafeTenant } from '@/modules/tenant/tenant.types';

// TODO: import { AuthMiddleware } from "@/modules/auth/middleware"

const tenantRouter = Router();

tenantRouter.post(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateTenantDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const tenant: SafeTenant = await TenantService.create(parsed.data);
      res.status(201).json(tenant);
    } catch (err) {
      next(err);
    }
  },
);

tenantRouter.get(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetTenantsDTO.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await TenantService.getAll(parsed.data);

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

tenantRouter.get(
  '/:tenantId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetTenantDTO.safeParse({ tenantId: req.params.tenantId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const tenant: SafeTenant = await TenantService.getById(parsed.data.tenantId!);
      res.json(tenant);
    } catch (err) {
      next(err);
    }
  },
);

tenantRouter.put(
  '/:tenantId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParsed = GetTenantDTO.safeParse({ tenantId: req.params.tenantId });
      if (!idParsed.success) {
        throw new AppError(idParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const bodyParsed = UpdateTenantDTO.safeParse(req.body);
      if (!bodyParsed.success) {
        throw new AppError(bodyParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const tenant: SafeTenant = await TenantService.update(
        idParsed.data.tenantId!,
        bodyParsed.data,
      );

      res.json(tenant);
    } catch (err) {
      next(err);
    }
  },
);

tenantRouter.delete(
  '/:tenantId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetTenantDTO.safeParse({ tenantId: req.params.tenantId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantService.delete(parsed.data.tenantId!);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantRouter;
