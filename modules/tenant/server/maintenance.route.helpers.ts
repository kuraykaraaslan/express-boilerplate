import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import type { MaintenanceWindowView } from './maintenance.dto';
import type { MaintenanceCaller } from './maintenance.service';
import MaintenanceMessages from './maintenance.messages';

export const MAINTENANCE_PERM = 'tenant.maintenance.manage';

/** Maintenance actions are high-impact — every one lands in the audit log. */
export function auditMaintenance(
  tenantId: string,
  actorId: string | null | undefined,
  action: string,
  windowId: string,
  metadata?: Record<string, unknown>,
): void {
  AuditLogService.log({
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType: 'MaintenanceWindow',
    resourceId: windowId,
    metadata: metadata ?? {},
  }).catch(() => { /* audit failure must not block the mutation */ });
}

/**
 * Whether the caller may schedule, change, start, end or cancel SYSTEM (whole-platform) windows. One place for the
 * check every maintenance route and the console's `canManageSystem` flag use (41-ui-fixes/09 B2.1).
 *
 * 41-ui-fixes/09 B2.4 (recorded follow-up): this is still the legacy `userRole === 'ADMIN'` test. The platform
 * super-admin is a root-tenant ADMIN member (auth.admin-guard.next.ts), but no reusable server helper answers "is this
 * caller a platform admin" for a tenant-scoped route (the session layer's own `isGlobalAdmin` is the same userRole
 * test), so the switch waits for one; when it lands, only this function and `MaintenanceService.isAllowed` change.
 */
export function canManageSystemWindows(userRole: string | null | undefined): boolean {
  return userRole === 'ADMIN';
}

/** Scheduling a SYSTEM window takes a platform admin (403 otherwise); TENANT and ROUTE are pinned to the path tenant. */
export function assertMayScheduleScope(scope: string, userRole: string | null | undefined): void {
  if (scope === 'SYSTEM' && !canManageSystemWindows(userRole)) {
    throw new AppError(MaintenanceMessages.SYSTEM_REQUIRES_PLATFORM_ADMIN, 403, ErrorCode.FORBIDDEN);
  }
}

/** The caller as the service's lock-out guard needs it (1.5), from the route's authorization result. */
export function maintenanceCaller(auth: { user: { userRole?: string | null }; tenantMember?: { memberRole?: string | null } | null }): MaintenanceCaller {
  return { userRole: auth.user.userRole ?? null, memberRole: auth.tenantMember?.memberRole ?? null };
}

/**
 * Ownership for writes: a tenant console edits its own windows; a SYSTEM
 * window (tenantId=null) gates every tenant, so only a platform ADMIN may
 * touch it. Reading is looser on purpose — the list route shows SYSTEM
 * windows to every console they gate.
 */
export function assertCanManage(window: MaintenanceWindowView, tenantId: string, userRole: string): void {
  if (window.tenantId === tenantId) return;
  if (window.tenantId === null && canManageSystemWindows(userRole)) return;
  throw new AppError(
    window.tenantId === null
      ? MaintenanceMessages.SYSTEM_REQUIRES_PLATFORM_ADMIN
      : 'Maintenance window not found',
    window.tenantId === null ? 403 : 404,
    window.tenantId === null ? ErrorCode.FORBIDDEN : ErrorCode.NOT_FOUND,
  );
}
