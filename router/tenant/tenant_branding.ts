import { Router, Request, Response, NextFunction } from 'express';
import TenantBrandingService from '@/modules/tenant_branding/tenant_branding.service';

const tenantBrandingRouter = Router({ mergeParams: true });

tenantBrandingRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      const branding = await TenantBrandingService.get(tenantId);
      res.json(branding);
    } catch (err) {
      next(err);
    }
  },
);

tenantBrandingRouter.put(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      const branding = await TenantBrandingService.update(tenantId, req.body);
      res.json(branding);
    } catch (err) {
      next(err);
    }
  },
);

tenantBrandingRouter.delete(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      await TenantBrandingService.reset(tenantId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantBrandingRouter;
