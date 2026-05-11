import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import TenantSubscriptionService from '../tenant_subscription.service';
import { CreateSubscriptionDTO } from '../tenant_subscription.dto';

// TODO: import { AuthMiddleware } from '@/modules/auth/router';

const tenantSubscriptionRouter = Router({ mergeParams: true });

/**
 * GET /plans
 * List all active subscription plans. Public.
 */
tenantSubscriptionRouter.get(
  '/plans',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const plans = await TenantSubscriptionService.findAllPlans();
      res.json(plans);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /
 * Get the tenant's current subscription. Requires AUTH.
 */
tenantSubscriptionRouter.get(
  '/',
  // TODO: AuthMiddleware(),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const subscription = await TenantSubscriptionService.findByTenant(tenantId);
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

/**
 * POST /
 * Create a new subscription. Requires OWNER.
 */
tenantSubscriptionRouter.post(
  '/',
  // TODO: AuthMiddleware('OWNER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
      if (!tenantId) {
        throw new AppError('Missing tenantId', 400, ErrorCode.VALIDATION_ERROR);
      }

      const parsed = CreateSubscriptionDTO.safeParse({ ...req.body, tenantId });
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      // Create trial subscription for the tenant if none exists yet
      const subscription = await TenantSubscriptionService.createTrialSubscription(
        parsed.data.tenantId,
      );

      res.status(201).json(subscription);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /
 * Cancel the tenant's subscription. Requires OWNER.
 */
tenantSubscriptionRouter.delete(
  '/',
  // TODO: AuthMiddleware('OWNER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tenantId: string = (req as Request & { tenantId?: string }).tenantId ?? '';
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
