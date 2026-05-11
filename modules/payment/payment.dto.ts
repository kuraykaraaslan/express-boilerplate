import { z } from 'zod';
import { PaymentProviderEnum } from './payment.enums';

export const CreatePaymentDTO = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).optional().default('USD'),
  provider: PaymentProviderEnum.optional(),
});

export const GetPaymentDTO = z.object({
  paymentId: z.string().uuid(),
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentDTO>;
export type GetPaymentInput = z.infer<typeof GetPaymentDTO>;
