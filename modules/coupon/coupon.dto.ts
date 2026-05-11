import { z } from 'zod';

export const ValidateCouponDTO = z.object({
  code: z.string().min(1),
  tenantId: z.string().uuid(),
});

export const RedeemCouponDTO = z.object({
  code: z.string().min(1),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
});

export type ValidateCouponInput = z.infer<typeof ValidateCouponDTO>;
export type RedeemCouponInput = z.infer<typeof RedeemCouponDTO>;
