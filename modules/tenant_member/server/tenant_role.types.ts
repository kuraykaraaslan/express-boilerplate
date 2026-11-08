import type { PermissionFloor } from './tenant_member.enums';

/** A role as consumed by the matrix / enforcement — persisted or synthesized. */
export interface RoleView {
  key: string;
  label: string;
  description: string | null;
  permissions: string[];
  isBuiltin: boolean;
  /**
   * Optional so a cache entry written before this field existed still parses —
   * and it reads as ACTIVE when absent, which is exactly the behaviour those
   * entries had (nothing consulted the column at all).
   */
  isActive?: boolean;
}

export interface CachedRoleSet {
  roles: RoleView[];
  /** True when the tenant has persisted role rows (has edited access control). */
  seeded: boolean;
}

export interface AccessMatrixPermission {
  id: string;
  name: string;
  description?: string;
  group?: string;
  minRole?: PermissionFloor;
  moduleId: string;
  /**
   * Owner-only to grant. Marked here rather than re-derived in the browser so
   * the rule lives in exactly one place — the picker greys the row out, the
   * write service is still the thing that refuses.
   */
  sensitive: boolean;
}
export interface AccessMatrixRole {
  key: string;
  label: string;
  isBuiltin: boolean;
  grants: string[];
}
export interface AccessMatrix {
  permissions: AccessMatrixPermission[];
  roles: AccessMatrixRole[];
}
