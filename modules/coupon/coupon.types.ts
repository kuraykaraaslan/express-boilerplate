import { z } from 'zod';
import { DiscountTypeEnum } from './coupon.enums';

export const CouponSchema = z.object({
  couponId: z.string().uuid(),
  code: z.string(),
  discountType: DiscountTypeEnum,
  discountValue: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  currency: z.string().nullable().optional(),
  maxUses: z.number().nullable().optional(),
  currentUses: z.number().default(0),
  expiresAt: z.date().nullable().optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const CouponRedemptionSchema = z.object({
  redemptionId: z.string().uuid(),
  couponId: z.string(),
  tenantId: z.string(),
  userId: z.string(),
  redeemedAt: z.date(),
});

export type Coupon = z.infer<typeof CouponSchema>;
export type CouponRedemption = z.infer<typeof CouponRedemptionSchema>;
