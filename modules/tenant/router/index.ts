import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import TenantService from '../tenant.service';
import {
  CreateTenantDTO,
  UpdateTenantDTO,
  GetTenantsDTO,
  TenantIdDTO,
} from '../tenant.dto';
import { SafeTenant } from '../tenant.types';

// TODO: import { AuthMiddleware } from "@/modules/auth/router"

const tenantRouter = Router();

/**
 * POST /
 * Create a new tenant. Requires authenticated USER.
 */
tenantRouter.post(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateTenantDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      // TODO: derive ownerId from req.user once AuthMiddleware is wired
      const ownerId: string = (req as Request & { user?: { userId: string } }).user?.userId ?? '';
      if (!ownerId) {
        throw new AppError('Unauthorized', 401, ErrorCode.UNAUTHORIZED);
      }

      const tenant: SafeTenant = await TenantService.create(parsed.data, ownerId);
      res.status(201).json(tenant);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /
 * List the authenticated user's tenants. Requires authenticated USER.
 */
tenantRouter.get(
  '/',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = GetTenantsDTO.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const ownerId: string | undefined = (req as Request & { user?: { userId: string } }).user?.userId;

      const result = await TenantService.list({
        ...parsed.data,
        ownerId: parsed.data.ownerId ?? ownerId,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /:tenantId
 * Get a specific tenant by ID. Requires authenticated USER.
 */
tenantRouter.get(
  '/:tenantId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = TenantIdDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const tenant: SafeTenant = await TenantService.findById(parsed.data.tenantId);
      res.json(tenant);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /:tenantId
 * Update a tenant. Requires ADMIN role or tenant owner.
 */
tenantRouter.put(
  '/:tenantId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idParsed = TenantIdDTO.safeParse(req.params);
      if (!idParsed.success) {
        throw new AppError(idParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const bodyParsed = UpdateTenantDTO.safeParse(req.body);
      if (!bodyParsed.success) {
        throw new AppError(bodyParsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      // TODO: enforce ADMIN or owner check once AuthMiddleware is wired
      const tenant: SafeTenant = await TenantService.update(
        idParsed.data.tenantId,
        bodyParsed.data,
      );

      res.json(tenant);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:tenantId
 * Soft-delete a tenant. Requires ADMIN role or tenant owner.
 */
tenantRouter.delete(
  '/:tenantId',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = TenantIdDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      // TODO: enforce ADMIN or owner check once AuthMiddleware is wired
      await TenantService.delete(parsed.data.tenantId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantRouter;
