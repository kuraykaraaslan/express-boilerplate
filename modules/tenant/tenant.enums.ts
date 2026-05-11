import { z } from 'zod';

export const TenantStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export type TenantStatus = z.infer<typeof TenantStatusEnum>;
