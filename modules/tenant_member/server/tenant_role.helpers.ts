import { env } from '@kuraykaraaslan-labs/env';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import type { TenantRole as TenantRoleEntity } from './entities/tenant_role.entity';
import { PERMISSION_MATRIX, PERMISSION_ROLES } from './tenant_member.permissions';
import type { TenantMemberRole, PermissionFloor } from './tenant_member.enums';
import type { RoleView } from './tenant_role.types';

export const ROLES_CACHE_TTL = env.TENANT_CACHE_TTL ?? 60 * 5;

export { cacheKey, rolesVersionKey } from './tenant_role.keys';

// Permissions that grant owner-level or authorization-wide power. Toggling any
// of these (or editing the OWNER role at all) is restricted to OWNERs.
const SENSITIVE_PERMISSIONS = new Set<string>([
  'members.manage_owner',
  'members.transfer_ownership',
]);
export function isSensitive(permissionId: string): boolean {
  return SENSITIVE_PERMISSIONS.has(permissionId) || permissionId.startsWith('abac.');
}

/**
 * The permission ids a grant may name (tenant_member.11, fixed 2026-10-20): every id a loaded module declares plus the coarse matrix
 * keys. A custom group or a matrix grant naming anything else (a typo, an id another module may declare one day) is refused, so a
 * later module cannot silently grant that id to every holder.
 */
export function unknownPermissionIds(ids: readonly string[]): string[] {
  const known = new Set<string>([...moduleRegistry.getPermissions().map((p) => p.id), ...PERMISSION_MATRIX.map((row) => row.key)]);
  return [...new Set(ids)].filter((id) => !known.has(id));
}

// Rank used to gate default grants by a permission's `minRole` floor.
// GUEST is rank 0 — a public floor cleared by every built-in role.
const ROLE_RANK: Record<PermissionFloor, number> = { OWNER: 3, ADMIN: 2, USER: 1, GUEST: 0 };

/** A permission's default role floor: sensitive → OWNER, else its `minRole` (default ADMIN). */
function minRoleOfPermission(p: { id: string; minRole?: PermissionFloor }): PermissionFloor {
  if (isSensitive(p.id)) return 'OWNER';
  return p.minRole ?? 'ADMIN';
}

/**
 * The three built-in roles' default grants. The coarse `PERMISSION_MATRIX` is the
 * base; on top of it every permission registered across module.json manifests is
 * granted **by min-role rank** — a role R gets permission P iff
 * `rank(R) >= rank(minRoleOf(P))`. This makes the access-control matrix reflect real
 * capability, reproduces each route's old `requiredTenantRole` floor (so migrated
 * routes don't lock members out), and lets the ABAC guard enforce a *removal*.
 * Because OWNER always holds the full set, revoking a permission from a lower role
 * leaves it "known to the tenant" — the signal `hasPermission` uses to treat the
 * removal as an explicit deny. The `ADMIN` column of the coarse matrix still vetoes
 * (a coarse-admin-denied key is never granted to ADMIN via the registered set).
 */
export function synthesizeBuiltins(): RoleView[] {
  const registered = moduleRegistry.getPermissions();
  const deniedToAdmin = new Set(
    PERMISSION_MATRIX.filter((row) => !row.roles.ADMIN).map((row) => row.key),
  );
  return PERMISSION_ROLES.map((role: TenantMemberRole) => {
    const coarse = PERMISSION_MATRIX.filter((row) => row.roles[role]).map((row) => row.key);
    const granted = registered
      .filter((p) => ROLE_RANK[role] >= ROLE_RANK[minRoleOfPermission(p)])
      .filter((p) => !(role === 'ADMIN' && deniedToAdmin.has(p.id)))
      .map((p) => p.id);
    return {
      key: role,
      label: role.charAt(0) + role.slice(1).toLowerCase(),
      description: null,
      permissions: [...new Set([...coarse, ...granted])],
      isBuiltin: true,
    };
  });
}

export function toView(row: TenantRoleEntity): RoleView {
  return {
    key: row.key,
    label: row.label,
    description: row.description,
    permissions: row.permissions ?? [],
    isBuiltin: row.isBuiltin,
    isActive: row.isActive,
  };
}
