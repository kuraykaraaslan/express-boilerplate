import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import TenantDomainService from '@/modules/tenant_domain/tenant_domain.service';
import {
  CreateTenantDomainDTO,
  VerifyDomainDTO,
  GetTenantDomainsDTO,
} from '@/modules/tenant_domain/tenant_domain.dto';

// TODO: import { AuthMiddleware } from '@/modules_express/auth/middleware';

const tenantDomainRouter = Router({ mergeParams: true });

tenantDomainRouter.get(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = GetTenantDomainsDTO.safeParse({
        tenantId,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 10,
      });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await TenantDomainService.getByTenantId(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

tenantDomainRouter.post(
  '/',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = CreateTenantDomainDTO.safeParse({ ...req.body, tenantId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const domain = await TenantDomainService.create(parsed.data);
      res.status(201).json(domain);
    } catch (err) {
      next(err);
    }
  },
);

tenantDomainRouter.post(
  '/:tenantDomainId/verify',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = VerifyDomainDTO.safeParse({ tenantDomainId: req.params.tenantDomainId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const domain = await TenantDomainService.verifyDomain(parsed.data.tenantDomainId);
      res.json(domain);
    } catch (err) {
      next(err);
    }
  },
);

tenantDomainRouter.put(
  '/:tenantDomainId/primary',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantDomainId } = req.params;
      if (!tenantDomainId) {
        throw new AppError('Missing tenantDomainId', 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantDomainService.update(tenantDomainId, { isPrimary: true });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

tenantDomainRouter.delete(
  '/:tenantDomainId',
  // TODO: AuthMiddleware('ADMIN'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { tenantDomainId } = req.params;
      if (!tenantDomainId) {
        throw new AppError('Missing tenantDomainId', 400, ErrorCode.VALIDATION_ERROR);
      }

      await TenantDomainService.delete(tenantDomainId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantDomainRouter;
