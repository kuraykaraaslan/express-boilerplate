import { z } from 'zod';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { TenantMemberRoleEnum } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import { TenantInvitationStatusEnum } from './tenant_invitation.enums';

export const SendInvitationDTO = z.object({
  email: z.string().email(),
  // 05-tenant-member 3.1: no default here. An invitation without a role gets the tenant's defaultMemberRole, resolved in send().
  memberRole: TenantMemberRoleEnum.optional(),
});

export const AcceptInvitationDTO = z.object({
  token: z.string().min(1),
});

export const DeclineInvitationDTO = z.object({
  token: z.string().min(1),
});

export const GetInvitationsDTO = z.object({
  tenantId: z.string().uuid(),
  page: z.number().default(1),
  pageSize: z.number().default(10),
  status: TenantInvitationStatusEnum.nullable().optional(),
  // phase 43 list contract (optional: internal callers leave them out)
  statuses: z.array(TenantInvitationStatusEnum).optional(),
  memberRoles: z.array(z.string()).optional(),
  search: z.string().optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  expiresFrom: z.string().optional(),
  expiresTo: z.string().optional(),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })).optional(),
});

/** Public sort fields of the invitation list → entity properties (phase 43 list contract). */
export const INVITATION_SORTABLE = {
  email: 'email',
  memberRole: 'memberRole',
  status: 'status',
  expiresAt: 'expiresAt',
  createdAt: 'createdAt',
} as const;

/**
 * The invitation list (phase 43 list contract): newest first unless sorted; one or several statuses and roles, sent and
 * expiry day ranges, a search over the e-mail. 1-based as before, 10 rows by default, at most 100 (the page size had no
 * cap before).
 */
export const ListInvitationsQuery = listQuerySchema({
  sortable: INVITATION_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageBase: 1,
  pageSize: { default: 10, max: 100 },
  filters: {
    status: listFilter.oneOf(TenantInvitationStatusEnum.options),
    memberRole: listFilter.oneOf(TenantMemberRoleEnum.options),
    createdFrom: listFilter.day(),
    createdTo: listFilter.day(),
    expiresFrom: listFilter.day(),
    expiresTo: listFilter.day(),
  },
});

export type SendInvitationInput = z.infer<typeof SendInvitationDTO>;
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationDTO>;
export type DeclineInvitationInput = z.infer<typeof DeclineInvitationDTO>;
export type GetInvitationsInput = z.infer<typeof GetInvitationsDTO>;
