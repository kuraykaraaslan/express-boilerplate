import { z } from 'zod';
import { PaymentStatusEnum, PaymentProviderEnum } from './payment.enums';

export const PaymentSchema = z.object({
  paymentId: z.string().uuid(),
  tenantId: z.string(),
  userId: z.string(),
  amount: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  currency: z.string().default('USD'),
  status: PaymentStatusEnum,
  provider: PaymentProviderEnum,
  externalId: z.string().nullable().optional(),
  checkoutUrl: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).nullable().optional(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type Payment = z.infer<typeof PaymentSchema>;

export interface CheckoutSessionResult {
  checkoutUrl: string;
  externalId: string;
}

export interface CreateCheckoutParams {
  paymentId: string;
  amount: number;
  currency: string;
  tenantId: string;
  userId: string;
  metadata?: Record<string, string>;
  successUrl?: string;
  cancelUrl?: string;
}
