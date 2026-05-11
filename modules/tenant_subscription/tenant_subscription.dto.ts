import { z } from 'zod';
import { SubscriptionStatusEnum, BillingCycleEnum } from './tenant_subscription.enums';

export const CreateSubscriptionDTO = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid(),
  billingCycle: BillingCycleEnum,
});

export const UpdateSubscriptionStatusDTO = z.object({
  tenantId: z.string().uuid(),
  status: SubscriptionStatusEnum,
});

export const GetSubscriptionDTO = z.object({
  tenantId: z.string().uuid(),
});

export type CreateSubscriptionInput = z.infer<typeof CreateSubscriptionDTO>;
export type UpdateSubscriptionStatusInput = z.infer<typeof UpdateSubscriptionStatusDTO>;
export type GetSubscriptionInput = z.infer<typeof GetSubscriptionDTO>;
