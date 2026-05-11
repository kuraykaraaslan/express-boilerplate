import { Router, Request, Response, NextFunction } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import CouponService from '../coupon.service';
import { ValidateCouponDTO, RedeemCouponDTO } from '../coupon.dto';

const couponRouter = Router();

/**
 * POST /validate
 * Validate a coupon code. Requires authenticated USER.
 */
couponRouter.post(
  '/validate',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ValidateCouponDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const coupon = await CouponService.validate(parsed.data.code, parsed.data.tenantId);
      const discount = CouponService.calculateDiscount(coupon, 0);
      res.json({ valid: true, coupon, discount });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /redeem
 * Redeem a coupon. Requires authenticated USER.
 */
couponRouter.post(
  '/redeem',
  // TODO: AuthMiddleware('USER'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = RedeemCouponDTO.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(parsed.error.message, 400, ErrorCode.VALIDATION_ERROR);
      }

      const redemption = await CouponService.redeem(
        parsed.data.code,
        parsed.data.tenantId,
        parsed.data.userId,
      );
      res.status(201).json(redemption);
    } catch (err) {
      next(err);
    }
  },
);

export default couponRouter;
