import redis from '@kuraykaraaslan-labs/redis';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';

/** One audit row per session and tenant per window: a list-heavy admin screen makes dozens of requests a minute. */
export const GLOBAL_ADMIN_AUDIT_WINDOW_SECONDS = 60 * 60;

/**
 * 38-security 5.8: a platform admin reaching into a tenant it is not a member of (the plain global-admin bypass) used to leave no trace;
 * impersonation and break-glass were logged, this was the invisible one. Writes `security.global_admin_access` under the TENANT's own audit
 * chain (so its owners see it in their own audit view), keyed by user, session and tenant, at most once per window (Redis `SET NX EX`).
 * Fire-and-forget: it never blocks or fails the request. A Redis failure writes the row anyway (a duplicate beats a silent bypass).
 * The admin's own home (root) tenant is not an "access" and is skipped.
 */
export function auditGlobalAdminAccess(input: { userId: string; userSessionId: string; tenantId: string; ipAddress?: string | null; method?: string; path?: string }): void {
  if (isRootTenant(input.tenantId)) return;
  void (async () => {
    try {
      let first = true;
      try {
        first = (await redis.set(`global-admin-audit:${input.userSessionId}:${input.tenantId}`, '1', 'EX', GLOBAL_ADMIN_AUDIT_WINDOW_SECONDS, 'NX')) === 'OK';
      } catch {
        first = true;
      }
      if (!first) return;
      await AuditLogService.log({
        tenantId: input.tenantId,
        actorId: input.userId,
        actorType: 'USER',
        action: AuditActions.GLOBAL_ADMIN_ACCESS,
        resourceType: 'tenant',
        resourceId: input.tenantId,
        ipAddress: input.ipAddress ?? undefined,
        metadata: { userSessionId: input.userSessionId, method: input.method ?? null, path: input.path ?? null },
      });
    } catch {
      /* best-effort */
    }
  })();
}
