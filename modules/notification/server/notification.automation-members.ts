/**
 * The active members of a tenant role, for the `role` recipients of `action.notify` (05 §5.20). `tenant_member` is always on
 * (a protected module), and is loaded lazily so a unit test or an edge bundle never opens a connection. One page of
 * `limit + 1` is read: the caller sees an overflow without paying for the rest, and a role with thousands of members is refused
 * instead of mailing them (the node caps recipients at 20).
 */
export type RoleMembers = (tenantId: string, role: string, limit: number) => Promise<string[] | null>;

export const ROLES = ['OWNER', 'ADMIN', 'USER'] as const;

/** The user ids of the ACTIVE members holding `role`, at most `limit + 1`; null when the lookup failed (the node fails closed). */
export const defaultRoleMembers: RoleMembers = async (tenantId, role, limit) => {
  try {
    const { getByTenantId } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service');
    const { members } = await getByTenantId({ tenantId, page: 1, pageSize: limit + 1, memberRole: role as (typeof ROLES)[number], memberStatus: 'ACTIVE' } as never);
    return members.map((m) => m.userId);
  } catch {
    return null;
  }
};

/** The user ids of the ACTIVE members holding the tenant's custom role `key` (a `tenant_member.roleKeys` entry), at most `limit + 1`; null on failure. */
export const defaultCustomRoleMembers: RoleMembers = async (tenantId, key, limit) => {
  try {
    const { getActiveUserIdsByRoleKey } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service');
    return await getActiveUserIdsByRoleKey(tenantId, key, limit + 1);
  } catch {
    return null;
  }
};

/** A custom role key as `tenant_role` stores it: case kept, no spaces. */
export const CUSTOM_ROLE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/** The user ids of the active members of an organization team, at most `limit + 1`; null on failure. `organization` is optional, so it is loaded lazily. */
export type TeamMembers = (tenantId: string, teamId: string, limit: number) => Promise<string[] | null>;

export const defaultTeamMembers: TeamMembers = async (tenantId, teamId, limit) => {
  try {
    const { default: OrganizationTeamService } = await import('@kuraykaraaslan-labs/organization/server/organization.team.service');
    const rows = await OrganizationTeamService.members(tenantId, teamId);
    return [...new Set(rows.map((r) => r.userId))].slice(0, limit + 1);
  } catch {
    return null;
  }
};
