import { z } from 'zod';

export const PaymentStatusEnum = z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED']);
export const PaymentProviderEnum = z.enum(['STRIPE', 'PAYPAL', 'IYZICO']);

export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;
export type PaymentProvider = z.infer<typeof PaymentProviderEnum>;
