import { env } from '@kuraykaraaslan-labs/env';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeUserSession, SessionMeta } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { globalAdminBypassAllowed } from './tenant_session.global-admin';

/**
 * Whether the tenant's IP allow/deny lists (`ipWhitelist` / `ipBlacklist`) do NOT apply to this caller in `tenantId`.
 * The one answer both the enforcement (tenant_session.authenticate.next.ts) and the settings write guard
 * (tenant_setting.ip-lists.ts, through `TenantAuthResult.ipListsExempt`) use, so the guard never refuses a list as
 * "locking you out" to a caller the lists never meet (review 2026-10-18). Exempt, by design (2026-10-18):
 *  - a platform admin (`userRole === 'ADMIN'`) wherever the global-admin bypass exists, even where a route turns that
 *    bypass off (the ROOT console): a bad list must not lock the platform out of the tenant it has to repair;
 *  - an impersonation of this tenant started by such an admin (the system flow). One a tenant ADMIN / OWNER started
 *    inside the tenant (the tenant flow) is NOT exempt: it is that member's access under another role. An impersonator
 *    that could not be loaded is not known to be a platform admin;
 *  - an open break-glass session minted for THIS tenant (fleet 04 section 6): the bounded, audited emergency way in,
 *    which a list must not be able to close. One minted for another tenant meets this tenant's lists.
 * Members are NOT exempt: the tenant's list protects the tenant's data.
 */
export function exemptFromIpLists({
  user,
  userSession,
  tenantId,
  impersonatedBy,
}: {
  user: Pick<SafeUser, 'userRole'>;
  userSession: Pick<SafeUserSession, 'tenantId' | 'metadata'>;
  tenantId: string;
  impersonatedBy?: Pick<SafeUser, 'userRole'> | null;
}): boolean {
  const meta = userSession.metadata as SessionMeta | null | undefined;
  if (meta?.breakGlass && userSession.tenantId === tenantId) return true;
  if (!globalAdminBypassAllowed(env.FLEET_ROLE)) return false;
  if (user.userRole === 'ADMIN') return true;
  const impersonation = meta?.impersonation;
  return !!impersonation && impersonation.tenantId === tenantId && !!impersonation.targetTenantRole
    && impersonatedBy?.userRole === 'ADMIN';
}
