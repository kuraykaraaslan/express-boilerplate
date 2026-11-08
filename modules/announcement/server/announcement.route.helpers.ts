import type { NextRequest } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { Sender } from './announcement.rules';

/** Composing and sending announcements. Narrow it per installation in config/access.ts. */
export const SEND_PERM = 'announcements.send';
/** Seeing the announcements meant for oneself in the shell. */
export const VIEW_PERM = 'announcements.view';

/**
 * Who is sending (D15). In the root tenant it is the platform operator, behind the KD-13 IP/MFA gate (`GLOBAL`), and
 * the announcement can reach every tenant; anywhere else it is that tenant's admin, to their own workspace.
 */
export async function authorizeSender(request: NextRequest, tenantId: string): Promise<{ sender: Sender; userId: string }> {
  if (tenantId === ROOT_TENANT_ID) {
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: SEND_PERM, scope: 'GLOBAL' });
    return { sender: { tenantId: null }, userId: auth.user.userId };
  }
  const auth = await authorizeRequest({ request, tenantId, requiredPermission: SEND_PERM, scope: 'TENANT' });
  return { sender: { tenantId }, userId: auth.user.userId };
}

/** Every send, schedule, withdrawal and test lands in the audit log: who, what, to whom. */
export function auditAnnouncement(
  tenantId: string, actorId: string, action: string, announcementId: string, metadata: Record<string, unknown> = {},
): void {
  AuditLogService.log({
    tenantId, actorId, actorType: 'USER', action, resourceType: 'Announcement', resourceId: announcementId, metadata,
  }).catch(() => { /* an audit failure must not undo the send */ });
}
