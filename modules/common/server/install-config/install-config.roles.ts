import { isRootTenant } from '../tenant-constants';
import type { InstallRole } from './install-config.define';

/** Who the viewer is, in the words of config/menu.ts and config/access.ts. */
export type InstallRoleLabels = {
  /** The built-in role, `null` for an anonymous caller. */
  role: InstallRole | null;
  /** The custom groups (tenant role keys) the member holds. */
  customGroups: string[];
};

/** The facts of a session the labels are worked out from (a tenant member, a global admin, or an account-only user). */
export type InstallSubject = {
  tenantId: string;
  memberRole?: string | null;
  roleKeys?: readonly string[] | null;
  /** A platform admin acting in another tenant (tenant_session's virtual OWNER member). */
  isGlobalAdmin?: boolean;
  /** The platform user role, for a caller without a membership (the ACCOUNT and GLOBAL scopes). */
  userRole?: string | null;
};

/**
 * The viewer's install roles. `sysadmin` is the platform's operator: an owner or admin of the root tenant, or a global
 * admin wherever they act (never also `owner`/`admin`, so a tenant-role rule never reaches the operator). Everyone else
 * is their built-in tenant role; without a membership, the platform user role decides (ADMIN is the operator).
 */
export function installRoleLabels(subject: InstallSubject): InstallRoleLabels {
  const customGroups = [...new Set(subject.roleKeys ?? [])];
  if (subject.isGlobalAdmin) return { role: 'sysadmin', customGroups: [] };
  const member = subject.memberRole ?? null;
  if (member === 'OWNER' || member === 'ADMIN') {
    return { role: isRootTenant(subject.tenantId) ? 'sysadmin' : member === 'OWNER' ? 'owner' : 'admin', customGroups };
  }
  if (member === 'USER') return { role: 'user', customGroups };
  if (subject.userRole === 'ADMIN') return { role: 'sysadmin', customGroups: [] };
  if (subject.userRole === 'USER') return { role: 'user', customGroups: [] };
  return { role: null, customGroups: [] };
}
