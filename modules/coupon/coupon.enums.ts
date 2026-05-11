import { z } from 'zod';

export const DiscountTypeEnum = z.enum(['PERCENTAGE', 'FIXED']);

export type DiscountType = z.infer<typeof DiscountTypeEnum>;
