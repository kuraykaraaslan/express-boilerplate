import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules_express/common/app-error';
import TenantSubscriptionService from '@/modules/tenant_subscription/tenant_subscription.service';
import { AssignSubscriptionRequestSchema } from '@/modules/tenant_subscription/tenant_subscription.dto';

// TODO: import { AuthMiddleware } from '@/modules_express/auth/middleware';

const tenantSubscriptionRouter = Router({ mergeParams: true });

tenantSubscriptionRouter.get(
  '/plans',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plans = await TenantSubscriptionService.getPlans();
      res.json(plans);
    } catch (err) {
      next(err);
    }
  },
);

tenantSubscriptionRouter.get(
  '/',
  // TODO: AuthMiddleware(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const subscription = await TenantSubscriptionService.getSubscription(tenantId);
      if (!subscription) {
        throw new AppError(
          'Subscription not found',
          404,
          ErrorCode.SUBSCRIPTION_REQUIRED,
        );
      }

      res.json(subscription);
    } catch (err) {
      next(err);
    }
  },
);

tenantSubscriptionRouter.post(
  '/',
  // TODO: AuthMiddleware('OWNER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = AssignSubscriptionRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const subscription = await TenantSubscriptionService.assignPlan(tenantId, parsed.data);

      res.status(201).json(subscription);
    } catch (err) {
      next(err);
    }
  },
);

tenantSubscriptionRouter.delete(
  '/',
  // TODO: AuthMiddleware('OWNER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = req.params.tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const subscription = await TenantSubscriptionService.cancelSubscription(tenantId);
      res.json(subscription);
    } catch (err) {
      next(err);
    }
  },
);

export default tenantSubscriptionRouter;
