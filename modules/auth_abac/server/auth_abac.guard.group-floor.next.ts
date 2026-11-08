import type { NextRequest } from 'next/server';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import type { PermissionFloor, TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import { authenticateAtFloor, FLOOR_RANK } from './auth_abac.guard.core.next';
import type { SubjectSource } from './auth_abac.attributes';
import { installVerdictOf } from './auth_abac.install-verdict';

// ── Custom groups and the coarse role floor ──────────────────────────────────
// A permission's `minRole` is a floor on the member's BUILT-IN role, checked before the policy engine runs. A custom
// group (`tenant_roles`, assigned through `tenant_members.roleKeys`) is additive: the engine already permits what a
// group grants (`grantedByCustomRole`), but the floor refused a USER member before the engine was asked, so a group
// could only ever grant permissions a USER could hold anyway.
//
// This file lets a group lift a permission over the floor, with two limits:
//  - Only an ADMIN floor. An OWNER-floor permission (ownership transfer, deleting the tenant) is never grantable by a group.
//  - Only for a real member, and only on routes that did not name their own `requiredTenantRole`. A global admin and an
//    impersonation behave exactly as before.

/** The highest floor a custom group may lift a permission over. */
export const GROUP_LIFT_CEILING: PermissionFloor = 'ADMIN';

/** May a custom group lift a permission with this floor? True only for an ADMIN floor. */
export function groupLiftApplies(floor: PermissionFloor): boolean {
  return floor === GROUP_LIFT_CEILING;
}

/**
 * The permissions the member's custom groups grant, from the member's own `roleKeys`. Empty for a member with no group,
 * and empty (fail closed) when the lookup fails: a missing answer must never lift a floor.
 */
export async function groupPermissionsOf(tenantId: string, member: { roleKeys?: string[] | null } | null | undefined): Promise<Set<string>> {
  const roleKeys = member?.roleKeys ?? [];
  if (!roleKeys.length) return new Set();
  try {
    const { default: TenantRoleService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_role.service');
    return new Set(await TenantRoleService.permissionsFor(tenantId, roleKeys));
  } catch {
    return new Set();
  }
}

/**
 * The permissions a group must NOT lift on the menu: those only system-scope entries name. A system-scope page is
 * served by a ROOT or GLOBAL route, which never lifts (this file only changes the TENANT path), so showing its link
 * to a group member would offer a page the API then refuses. A permission any tenant or both-scope entry also names
 * stays liftable, because that entry's route is a tenant route.
 */
export function permissionsExemptFromGroupLift(entries: Array<{ permissions: string[]; scope?: string }>): string[] {
  const liftable = new Set<string>();
  const seen = new Set<string>();
  for (const e of entries) {
    for (const p of e.permissions) {
      seen.add(p);
      if (e.scope !== 'system') liftable.add(p);
    }
  }
  return [...seen].filter((p) => !liftable.has(p));
}

/**
 * Does this member hold the permission through the floor, or through a group or a grant of the installation's
 * config/access.ts (docs/phases/45-install-config D45-4) that may lift it? Both lift an ADMIN floor only.
 */
export async function meetsFloorOrGroup(
  tenantId: string,
  member: { memberRole: string; roleKeys?: string[] | null },
  permissionId: string,
  floor: PermissionFloor,
): Promise<boolean> {
  if (FLOOR_RANK[member.memberRole as TenantMemberRole] >= FLOOR_RANK[floor]) return true;
  if (!groupLiftApplies(floor)) return false;
  if (installVerdictOf(tenantId, { user: null, tenantMember: member as SubjectSource['tenantMember'] }).granted.has(permissionId)) return true;
  return (await groupPermissionsOf(tenantId, member)).has(permissionId);
}

/**
 * The TENANT path's authentication for a route that takes its floor from the permission catalog.
 *
 * Authenticates at USER, so membership, status, 2FA and IP checks run exactly as before, then applies the real floor:
 * the built-in role meets it, or a custom group grants this permission over an ADMIN floor. Any other outcome
 * authenticates again at the real floor, which throws the ordinary 403 with its own audit row, so a refusal is
 * byte-identical to what it was.
 *
 * A route that names its own `requiredTenantRole`, a floor other than ADMIN, a global admin and an impersonation take
 * the unchanged path.
 */
export async function authenticateTenantAtPermissionFloor(args: {
  request: NextRequest;
  tenantId: string;
  requiredPermission: string;
  floor: PermissionFloor;
  explicitRole: TenantMemberRole | undefined;
}): Promise<TenantAuthResult> {
  const { request, tenantId, requiredPermission, floor, explicitRole } = args;
  const floorRole = explicitRole ?? ((floor === 'GUEST' ? 'USER' : floor) as TenantMemberRole);
  if (explicitRole || !groupLiftApplies(floor)) {
    return authenticateAtFloor(request, tenantId, floorRole, requiredPermission);
  }

  const auth = await authenticateAtFloor(request, tenantId, 'USER', requiredPermission);
  if (auth.isGlobalAdmin) return auth;
  if (await meetsFloorOrGroup(tenantId, auth.tenantMember, requiredPermission, floor)) return auth;
  return authenticateAtFloor(request, tenantId, floorRole, requiredPermission);
}
