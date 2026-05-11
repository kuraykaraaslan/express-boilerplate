import 'reflect-metadata';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { Coupon as CouponEntity } from './entities/Coupon';
import { CouponRedemption as CouponRedemptionEntity } from './entities/CouponRedemption';
import { CouponMessages } from './coupon.messages';
import { CouponSchema, CouponRedemptionSchema } from './coupon.types';
import type { Coupon, CouponRedemption } from './coupon.types';

export default class CouponService {
  private static get couponRepo() {
    return AppDataSource.getRepository(CouponEntity);
  }

  private static get redemptionRepo() {
    return AppDataSource.getRepository(CouponRedemptionEntity);
  }

  static async findByCode(code: string): Promise<Coupon | null> {
    const coupon = await CouponService.couponRepo.findOne({
      where: { code: code.toUpperCase() },
    });
    return coupon ? CouponSchema.parse(coupon) : null;
  }

  static calculateDiscount(coupon: Coupon, amount: number): number {
    if (coupon.discountType === 'PERCENTAGE') {
      return parseFloat(((amount * coupon.discountValue) / 100).toFixed(2));
    }
    // FIXED
    return Math.min(coupon.discountValue, amount);
  }

  static async validate(code: string, tenantId: string): Promise<Coupon> {
    const coupon = await CouponService.findByCode(code);

    if (!coupon) {
      throw new AppError(CouponMessages.COUPON_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    if (!coupon.isActive) {
      throw new AppError(CouponMessages.COUPON_INVALID, 400, ErrorCode.VALIDATION_ERROR);
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      throw new AppError(CouponMessages.COUPON_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);
    }

    if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.currentUses >= coupon.maxUses) {
      throw new AppError(CouponMessages.COUPON_MAX_USES_REACHED, 400, ErrorCode.VALIDATION_ERROR);
    }

    // Check if this tenant has already redeemed this coupon
    const existingRedemption = await CouponService.redemptionRepo.findOne({
      where: { couponId: coupon.couponId, tenantId },
    });

    if (existingRedemption) {
      throw new AppError(CouponMessages.COUPON_ALREADY_REDEEMED, 400, ErrorCode.CONFLICT);
    }

    return coupon;
  }

  static async redeem(code: string, tenantId: string, userId: string): Promise<CouponRedemption> {
    const coupon = await CouponService.validate(code, tenantId);

    return AppDataSource.transaction(async (manager) => {
      const redemptionRepo = manager.getRepository(CouponRedemptionEntity);
      const couponRepo = manager.getRepository(CouponEntity);

      const redemption = redemptionRepo.create({
        couponId: coupon.couponId,
        tenantId,
        userId,
      });
      const saved = await redemptionRepo.save(redemption);

      await couponRepo.increment({ couponId: coupon.couponId }, 'currentUses', 1);

      return CouponRedemptionSchema.parse(saved);
    });
  }
}
