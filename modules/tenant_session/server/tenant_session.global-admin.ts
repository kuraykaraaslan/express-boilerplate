/**
 * Whether a platform admin (`userRole === 'ADMIN'`) may act in ANY tenant without being its member: the global-admin bypass of
 * `authenticateTenantByRequest`. Never on a fleet NODE (docs/phases/02-fleet/08 section 7, `admin.no_global_userrole_bypass`): a node holds its
 * customers' data, and an operator reaches a customer tenant there through a membership or a break-glass grant, both audited and bounded, never
 * through a platform role. A single deployment and the control plane (which holds no customer data) keep it.
 */
export function globalAdminBypassAllowed(fleetRole: string | undefined): boolean {
  return fleetRole !== 'node';
}

/** The id prefix of the virtual OWNER member a platform admin acts through in a tenant (`authenticateTenantByRequest`). */
export const GLOBAL_ADMIN_MEMBER_ID_PREFIX = 'global-admin-';

/**
 * Is `member` the virtual member of a platform admin acting in a tenant? A real member's id is a uuid, so the prefix
 * cannot collide. For a caller that passes the member on but not the session's `isGlobalAdmin` flag.
 */
export function isGlobalAdminMember(member: { tenantMemberId?: string | null } | null | undefined): boolean {
  return typeof member?.tenantMemberId === 'string' && member.tenantMemberId.startsWith(GLOBAL_ADMIN_MEMBER_ID_PREFIX);
}
