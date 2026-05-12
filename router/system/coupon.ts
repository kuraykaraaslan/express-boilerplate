import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import CouponService from '@/modules/coupon/coupon.service';
import { ValidateCouponRequestSchema, ApplyCouponRequestSchema } from '@/modules/coupon/coupon.dto';

const couponRouter = Router();

couponRouter.post(
  '/validate',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ValidateCouponRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const result = await CouponService.validate(parsed.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

couponRouter.post(
  '/apply',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ApplyCouponRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const redemption = await CouponService.apply(parsed.data);
      res.status(201).json(redemption);
    } catch (err) {
      next(err);
    }
  },
);

export default couponRouter;
