import { z } from 'zod';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { TenantMemberRoleEnum, TenantMemberStatusEnum } from './tenant_member.enums';

export const CreateTenantMemberDTO = z.object({
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  memberRole: TenantMemberRoleEnum.default('USER'),
  memberStatus: TenantMemberStatusEnum.default('ACTIVE')
});

export const UpdateTenantMemberDTO = z.object({
  memberRole: TenantMemberRoleEnum.nullable(),
  memberStatus: TenantMemberStatusEnum.nullable(),
  /**
   * Custom role groups this member also holds (auth_abac phase 6.2). Absent
   * leaves them untouched — an update that only changes a status must not
   * silently unassign somebody's groups.
   */
  roleKeys: z.array(z.string().min(1).max(64)).max(20).optional()
});

export const GetTenantMemberDTO = z.object({
  tenantMemberId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable()
}).refine((data) => {
  return data.tenantMemberId || (data.tenantId && data.userId);
}, {
  message: "Either tenantMemberId or both tenantId and userId must be provided"
});

export const GetTenantMembersDTO = z.object({
  tenantId: z.string().uuid(),
  page: z.number().default(1),
  pageSize: z.number().default(10),
  search: z.string().nullable(),
  memberRole: TenantMemberRoleEnum.nullable(),
  memberStatus: TenantMemberStatusEnum.nullable(),
  // phase 43 list contract (optional: internal callers leave them out); several roles / statuses beside the single ones
  memberRoles: z.array(TenantMemberRoleEnum).optional(),
  memberStatuses: z.array(TenantMemberStatusEnum).optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })).optional(),
});

/** Public sort fields of the member list → entity properties (phase 43 list contract). */
export const MEMBER_SORTABLE = {
  memberRole: 'memberRole',
  memberStatus: 'memberStatus',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

/** `page` / `pageSize` were always clamped, never refused (tenant_invitation.01): the contract's keep that. */
const clampedInt = (def: number, min: number, max: number) => z.preprocess((v) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
}, z.number().int().min(min).max(max).default(def));

/**
 * The member list (phase 43 list contract): newest first unless sorted; one or several roles and statuses, a joined-day
 * range, a search over the members' e-mail. 0-based (the page index), 10 rows by default; page and pageSize are clamped
 * (0..100 000, 1..200) as before.
 */
export const ListTenantMembersQuery = listQuerySchema({
  sortable: MEMBER_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageSize: { default: 10, max: 200 },
  filters: {
    memberRole: listFilter.oneOf(TenantMemberRoleEnum.options),
    memberStatus: listFilter.oneOf(TenantMemberStatusEnum.options),
    createdFrom: listFilter.day(),
    createdTo: listFilter.day(),
  },
}).extend({ page: clampedInt(0, 0, 100_000), pageSize: clampedInt(10, 1, 200) });

export type CreateTenantMemberInput = z.infer<typeof CreateTenantMemberDTO>;
export type UpdateTenantMemberInput = z.infer<typeof UpdateTenantMemberDTO>;
export type GetTenantMemberInput = z.infer<typeof GetTenantMemberDTO>;
export type GetTenantMembersInput = z.infer<typeof GetTenantMembersDTO>;

/**
 * Hand ownership to another member. Every current OWNER steps down to `demoteTo`
 * (default ADMIN): a workspace with several owners ends with the one named here.
 */
export const TransferOwnershipDTO = z.object({
  toUserId: z.string().uuid(),
  demoteTo: z.enum(['ADMIN', 'USER']).default('ADMIN'),
});
export type TransferOwnershipInput = z.infer<typeof TransferOwnershipDTO>;
