import { Router, Request, Response, NextFunction } from 'express';
import { TenantUsageService } from '@/modules/tenant_usage/tenant_usage.service';

const tenantUsageRouter = Router({ mergeParams: true });

tenantUsageRouter.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      const month = req.query.month as string | undefined;
      const usage = await TenantUsageService.getUsage(tenantId, month);
      res.json(usage);
    } catch (err) {
      next(err);
    }
  },
);

tenantUsageRouter.post(
  '/flush',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId = req.params.tenantId ?? '';
      const month = (req.body?.month as string) ?? TenantUsageService.currentMonth();
      await TenantUsageService.flushToDb(tenantId, month);
      res.json({ message: 'Flushed', month });
    } catch (err) {
      next(err);
    }
  },
);

export default tenantUsageRouter;
