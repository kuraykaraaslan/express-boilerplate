import { z } from 'zod';
import { TenantMemberRoleEnum } from '@/modules/tenant_member/tenant_member.enums';
import { InvitationStatusEnum } from './tenant_invitation.enums';

export const CreateInvitationDTO = z.object({
  tenantId: z.string().uuid(),
  email: z.string().email(),
  memberRole: TenantMemberRoleEnum.default('USER').optional(),
});

export const AcceptInvitationDTO = z.object({
  token: z.string().min(1),
});

export const DeclineInvitationDTO = z.object({
  token: z.string().min(1),
});

export const GetInvitationsDTO = z.object({
  tenantId: z.string().uuid(),
  status: InvitationStatusEnum.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateInvitationInput = z.infer<typeof CreateInvitationDTO>;
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationDTO>;
export type DeclineInvitationInput = z.infer<typeof DeclineInvitationDTO>;
export type GetInvitationsInput = z.infer<typeof GetInvitationsDTO>;
