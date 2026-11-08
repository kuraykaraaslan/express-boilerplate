import type { TenantMemberRole } from './tenant_member.enums';

/**
 * Static permission-matrix reference — the authoritative "which memberRole can
 * do what" map. Pure data (no framework imports) so it is safe to import into a
 * 'use client' component as well as server code. The booleans mirror the guards
 * enforced in `tenant_member.write.service` and the members REST routes; this
 * table is documentation, not the enforcement point.
 */
export interface PermissionRow {
  key: string;
  label: string;
  description: string;
  /** Whether each role is granted this capability. */
  roles: Record<TenantMemberRole, boolean>;
}

export const PERMISSION_ROLES: TenantMemberRole[] = ['OWNER', 'ADMIN', 'USER'];

export const PERMISSION_MATRIX: PermissionRow[] = [
  {
    key: 'members.view',
    label: 'View members',
    description: 'See the tenant member directory and member detail pages.',
    roles: { OWNER: true, ADMIN: true, USER: true },
  },
  {
    key: 'members.invite',
    label: 'Invite members',
    description: 'Send invitations to add new people to the organization.',
    roles: { OWNER: true, ADMIN: true, USER: false },
  },
  {
    key: 'members.edit_role',
    label: 'Change member role / status',
    description: "Update another member's role or status (non-owners).",
    roles: { OWNER: true, ADMIN: true, USER: false },
  },
  {
    key: 'members.suspend',
    label: 'Suspend / reactivate members',
    description: 'Suspend a member (revoking their sessions) and lift suspensions.',
    roles: { OWNER: true, ADMIN: true, USER: false },
  },
  {
    key: 'members.remove',
    label: 'Remove members',
    description: 'Revoke a member’s access to the organization.',
    roles: { OWNER: true, ADMIN: true, USER: false },
  },
  {
    key: 'members.manage_owner',
    label: 'Modify / remove owners',
    description: 'Edit or remove another OWNER — reserved for owners only.',
    roles: { OWNER: true, ADMIN: false, USER: false },
  },
  {
    key: 'members.transfer_ownership',
    label: 'Transfer ownership',
    description: 'Promote another member to OWNER and step down.',
    roles: { OWNER: true, ADMIN: false, USER: false },
  },
  {
    key: 'members.settings',
    label: 'Manage membership settings',
    description: 'Configure the default member role and membership behavior.',
    roles: { OWNER: true, ADMIN: true, USER: false },
  },
];
