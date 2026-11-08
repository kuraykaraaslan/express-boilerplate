import 'reflect-metadata';
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import type { CreateRoleInput, UpdateRoleInput, SetGrantInput } from './tenant_role.dto';
import type { RoleView, AccessMatrix, CachedRoleSet } from './tenant_role.types';
import { loadSet, invalidate as invalidateCache } from './tenant_role.cache';
import { isSensitive } from './tenant_role.helpers';
import {
  saveMatrix as saveMatrixImpl,
  createRole as createRoleImpl,
  updateRole as updateRoleImpl,
  deleteRole as deleteRoleImpl,
  memberCounts as memberCountsImpl,
} from './tenant_role.write.service';

// Re-exported so importers of the service keep resolving these public types here.
export type {
  RoleView,
  AccessMatrix,
  AccessMatrixPermission,
  AccessMatrixRole,
} from './tenant_role.types';

/**
 * The pure core of {@link TenantRoleService.hasPermission}, over a role set the
 * caller already loaded. Split out so a bulk evaluation (the ABAC PDP's
 * `evaluateMany`) can load the set once and answer many permissions in memory,
 * with the exact same true/false/undefined contract as the single read.
 */
export function roleSetGrants(
  set: CachedRoleSet,
  roleKey: string,
  permissionId: string,
): boolean | undefined {
  const { roles, seeded } = set;
  if (!seeded) return undefined;
  const role = roles.find((r) => r.key === roleKey);
  if (!role) return undefined;
  if (role.permissions.includes(permissionId)) return true;
  const knownToTenant = roles.some((r) => r.permissions.includes(permissionId));
  return knownToTenant ? false : undefined;
}

export default class TenantRoleService {
  // ── Cache ────────────────────────────────────────────────────────────────

  static async invalidate(tenantId: string): Promise<void> {
    await invalidateCache(tenantId);
  }

  // ── Matrix (rows filtered to the tenant's ENABLED modules) ─────────────────

  static async getMatrix(tenantId: string): Promise<AccessMatrix> {
    const [{ roles }, enabled] = await Promise.all([
      loadSet(tenantId),
      getEnabledModuleIds(tenantId),
    ]);
    const permissions = moduleRegistry
      .getPermissions()
      .filter((p) => enabled.has(p.moduleId))
      .map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        group: p.group,
        moduleId: p.moduleId,
        sensitive: isSensitive(p.id),
      }));
    return {
      permissions,
      roles: roles.map((r) => ({ key: r.key, label: r.label, isBuiltin: r.isBuiltin, grants: r.permissions })),
    };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  /**
   * Apply a batch of grant changes (the matrix "Save"). `isOwner` gates
   * sensitive permissions / the OWNER column against non-owner admins.
   */
  static saveMatrix(
    tenantId: string,
    changes: SetGrantInput[],
    opts: { isOwner: boolean; actorId?: string },
  ): Promise<void> {
    return saveMatrixImpl(tenantId, changes, opts);
  }

  // ── Custom groups ────────────────────────────────────────────────────────

  static async listRoles(tenantId: string): Promise<RoleView[]> {
    const { roles } = await loadSet(tenantId);
    return roles;
  }

  static createRole(
    tenantId: string,
    input: CreateRoleInput,
    opts: { isOwner: boolean; actorId?: string },
  ): Promise<RoleView> {
    return createRoleImpl(tenantId, input, opts);
  }

  static updateRole(
    tenantId: string,
    roleKey: string,
    input: UpdateRoleInput,
    opts: { isOwner: boolean; actorId?: string },
  ): Promise<RoleView> {
    return updateRoleImpl(tenantId, roleKey, input, opts);
  }

  /** Deletes the group and returns how many members it was taken off. */
  static deleteRole(
    tenantId: string,
    roleKey: string,
    opts: { actorId?: string; isOwner?: boolean },
  ): Promise<{ unassignedMembers: number }> {
    return deleteRoleImpl(tenantId, roleKey, opts);
  }

  /**
   * Members per role key — built-in (`memberRole`) and custom (`roleKeys`)
   * alike. The roles screen needs it to say what a group is actually worth
   * before somebody deletes it.
   */
  static memberCounts(tenantId: string): Promise<Record<string, number>> {
    return memberCountsImpl(tenantId);
  }

  // ── Enforcement read ───────────────────────────────────────────────────────

  /**
   * Whether a role grants a permission — for the ABAC permission guard.
   *   - `true`  → the role grants it.
   *   - `false` → an **explicit** removal: the role lacks it BUT another role in
   *     the tenant grants it, so the tenant knows this permission and chose not to
   *     give it to this role.
   *   - `undefined` → unknown/no-opinion: the tenant is unseeded, the role key is
   *     dangling, OR **no** role in the tenant grants the permission (it postdates
   *     the tenant's seed). The guard treats `undefined` as permit, so a permission
   *     added after a tenant last edited access control never retroactively locks
   *     anyone out — the migration-safe contract.
   */
  /**
   * The union of permissions granted by a set of custom role keys.
   *
   * Only ACTIVE, non-builtin groups count. A builtin key would double-count the
   * matrix the fallback already consults, and an inactive group is how an
   * operator switches a set of grants off without unassigning everyone — so
   * both are skipped rather than silently honoured.
   *
   * An unknown key resolves to nothing instead of throwing: a member can hold a
   * key whose group was deleted, and a deleted group must mean "no extra
   * permissions", never a 500 on every request that member makes.
   */
  static async permissionsFor(tenantId: string, roleKeys: string[]): Promise<string[]> {
    if (!roleKeys?.length) return [];
    const { roles } = await loadSet(tenantId);
    const wanted = new Set(roleKeys);
    const out = new Set<string>();
    for (const role of roles) {
      if (!wanted.has(role.key) || role.isBuiltin || role.isActive === false) continue;
      for (const permission of role.permissions) out.add(permission);
    }
    return [...out];
  }

  static async hasPermission(
    tenantId: string,
    roleKey: string,
    permissionId: string,
  ): Promise<boolean | undefined> {
    return roleSetGrants(await loadSet(tenantId), roleKey, permissionId);
  }

  /** The tenant's effective (cached) role set, for callers that answer many checks over one read. */
  static roleSet(tenantId: string): Promise<CachedRoleSet> {
    return loadSet(tenantId);
  }
}
