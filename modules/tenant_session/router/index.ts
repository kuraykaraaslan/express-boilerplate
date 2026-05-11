import { Router, Request, Response, NextFunction } from 'express';
import TenantSessionExpressService from '../tenant_session.service.express';
import TenantSessionService from '../tenant_session.service';

const tenantSessionRouter = Router({ mergeParams: true });

/**
 * GET /me
 * Get the current user's membership in the tenant.
 */
tenantSessionRouter.get(
  '/me',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      const { user, userSession, tenant, tenantMember, isGlobalAdmin } =
        await TenantSessionExpressService.authenticateTenantByRequest({ request: req, tenantId });
      res.json({ user, userSession, tenant, tenantMember, isGlobalAdmin });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /tenants
 * Get all tenants the current user is a member of.
 */
tenantSessionRouter.get(
  '/tenants',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = (req as Request & { user?: { userId?: string } }).user?.userId ?? '';
      const tenants = await TenantSessionService.getUserTenants(userId);
      res.json(tenants);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /cache
 * Clear tenant cache for the current user and tenant.
 */
tenantSessionRouter.delete(
  '/cache',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      const userId = (req as Request & { user?: { userId?: string } }).user?.userId ?? '';
      await TenantSessionService.clearTenantCache(userId, tenantId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

export default tenantSessionRouter;
