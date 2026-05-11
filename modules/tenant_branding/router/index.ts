import { Router, Request, Response, NextFunction } from 'express';
import TenantBrandingService from '../tenant_branding.service';

const tenantBrandingRouter = Router({ mergeParams: true });

/**
 * GET /
 * Get branding settings for the tenant.
 */
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

/**
 * PUT /
 * Update branding settings for the tenant.
 */
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

/**
 * DELETE /
 * Reset branding settings for the tenant.
 */
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
