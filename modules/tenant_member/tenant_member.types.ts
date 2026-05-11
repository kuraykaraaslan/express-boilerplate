import { z } from 'zod';
import { TenantMemberRoleEnum, TenantMemberStatusEnum } from './tenant_member.enums';

export const TenantMemberSchema = z.object({
  tenantMemberId: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  memberRole: TenantMemberRoleEnum.default('USER'),
  memberStatus: TenantMemberStatusEnum.default('ACTIVE'),
  joinedAt: z.date().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const SafeTenantMemberSchema = TenantMemberSchema;

export type TenantMember = z.infer<typeof TenantMemberSchema>;
export type SafeTenantMember = z.infer<typeof SafeTenantMemberSchema>;
