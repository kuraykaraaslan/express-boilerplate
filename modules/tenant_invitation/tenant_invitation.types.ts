import { z } from 'zod';
import { InvitationStatusEnum } from './tenant_invitation.enums';
import { TenantMemberRoleEnum } from '@/modules/tenant_member/tenant_member.enums';

export const TenantInvitationSchema = z.object({
  invitationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  email: z.string().email(),
  invitedBy: z.string().uuid(),
  memberRole: TenantMemberRoleEnum.default('USER'),
  status: InvitationStatusEnum.default('PENDING'),
  token: z.string(),
  expiresAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type TenantInvitation = z.infer<typeof TenantInvitationSchema>;
