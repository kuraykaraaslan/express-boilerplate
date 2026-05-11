import { z } from 'zod';

export const TenantMemberRoleEnum = z.enum(['OWNER', 'ADMIN', 'USER']);
export type TenantMemberRole = z.infer<typeof TenantMemberRoleEnum>;

export const TenantMemberStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export type TenantMemberStatus = z.infer<typeof TenantMemberStatusEnum>;
