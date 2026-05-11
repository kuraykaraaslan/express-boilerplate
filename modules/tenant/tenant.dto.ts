import { z } from 'zod';
import { TenantStatusEnum } from './tenant.enums';

export const CreateTenantDTO = z.object({
  name: z.string().min(2).max(64),
  description: z.string().optional(),
  isPersonal: z.boolean().optional(),
});

export const UpdateTenantDTO = z.object({
  name: z.string().min(2).max(64).optional(),
  description: z.string().optional(),
  tenantStatus: TenantStatusEnum.optional(),
});

export const GetTenantsDTO = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  ownerId: z.string().uuid().optional(),
});

export const TenantIdDTO = z.object({
  tenantId: z.string().uuid(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantDTO>;
export type UpdateTenantInput = z.infer<typeof UpdateTenantDTO>;
export type GetTenantsInput = z.infer<typeof GetTenantsDTO>;
export type TenantIdInput = z.infer<typeof TenantIdDTO>;
