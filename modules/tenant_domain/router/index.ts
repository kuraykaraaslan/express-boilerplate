import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import TenantDomainService from '../tenant_domain.service';
import {
  AddDomainDTO,
  VerifyDomainDTO,
  RemoveDomainDTO,
  SetPrimaryDomainDTO,
} from '../tenant_domain.dto';

// TODO: import { AuthMiddleware } from '@/modules/auth/router';

const tenantDomainRouter = Router({ mergeParams: true });

/**
 * GET /
 * List tenant domains. Requires ADMIN.
 */
tenantDomainRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const domains = await TenantDomainService.findByTenant(tenantId);
      res.json(domains);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /
 * Add a new domain. Requires ADMIN.
 */
tenantDomainRouter.post(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = AddDomainDTO.safeParse({ ...req.body, tenantId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const domain = await TenantDomainService.add(parsed.data, tenantId);
      res.status(201).json(domain);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /:domainId/verify
 * Verify a domain. Requires ADMIN.
 */
tenantDomainRouter.post(
  '/:domainId/verify',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = VerifyDomainDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const domain = await TenantDomainService.verifyDomain(parsed.data.domainId);
      res.json(domain);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /:domainId/primary
 * Set domain as primary. Requires ADMIN.
 */
tenantDomainRouter.put(
  '/:domainId/primary',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = SetPrimaryDomainDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantDomainService.setPrimary(parsed.data.domainId, tenantId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /:domainId
 * Remove a domain. Requires ADMIN.
 */
tenantDomainRouter.delete(
  '/:domainId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = RemoveDomainDTO.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantDomainService.remove(parsed.data.domainId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantDomainRouter;
