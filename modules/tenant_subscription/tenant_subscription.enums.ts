import { z } from 'zod';

export const SubscriptionStatusEnum = z.enum([
  'ACTIVE',
  'INACTIVE',
  'TRIAL',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
]);

export const BillingCycleEnum = z.enum(['MONTHLY', 'ANNUAL']);

export const CurrencyEnum = z.enum(['USD', 'EUR', 'TRY', 'GBP']);

export type SubscriptionStatus = z.infer<typeof SubscriptionStatusEnum>;
export type BillingCycle = z.infer<typeof BillingCycleEnum>;
export type Currency = z.infer<typeof CurrencyEnum>;
