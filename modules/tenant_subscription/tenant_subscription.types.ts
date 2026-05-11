import { z } from 'zod';
import { SubscriptionStatusEnum, BillingCycleEnum, CurrencyEnum } from './tenant_subscription.enums';

export const TenantSubscriptionSchema = z.object({
  subscriptionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  planId: z.string().uuid().nullable(),
  status: SubscriptionStatusEnum.default('TRIAL'),
  trialEndsAt: z.coerce.date().nullable(),
  currentPeriodStart: z.coerce.date().nullable(),
  currentPeriodEnd: z.coerce.date().nullable(),
  cancelAtPeriodEnd: z.boolean().default(false),
  externalSubscriptionId: z.string().nullable(),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export const SubscriptionPlanSchema = z.object({
  planId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  monthlyPrice: z.coerce.number(),
  annualPrice: z.coerce.number(),
  currency: CurrencyEnum.default('USD'),
  features: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  isFree: z.boolean().default(false),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export type TenantSubscription = z.infer<typeof TenantSubscriptionSchema>;
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;
