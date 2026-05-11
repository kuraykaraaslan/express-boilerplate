import { z } from 'zod';
import { TenantMemberRoleEnum } from './tenant_member.enums';

export const AddMemberDTO = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  memberRole: TenantMemberRoleEnum.default('USER'),
});

export const UpdateMemberRoleDTO = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  memberRole: TenantMemberRoleEnum,
});

export const RemoveMemberDTO = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const GetMembersDTO = z.object({
  tenantId: z.string().uuid(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const CheckPermissionDTO = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  requiredRole: TenantMemberRoleEnum,
});

export type AddMemberInput = z.infer<typeof AddMemberDTO>;
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleDTO>;
export type RemoveMemberInput = z.infer<typeof RemoveMemberDTO>;
export type GetMembersInput = z.infer<typeof GetMembersDTO>;
export type CheckPermissionInput = z.infer<typeof CheckPermissionDTO>;
