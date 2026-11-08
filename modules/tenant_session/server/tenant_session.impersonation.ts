import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import UserSessionMessages from '@kuraykaraaslan-labs/user_session/server/user_session.messages';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';

/** The tenant roles that may start a tenant-flow impersonation (`auth_impersonation.tenant.start`, minRole ADMIN). */
const TENANT_IMPERSONATOR_ROLES = new Set(['OWNER', 'ADMIN']);

/**
 * auth_impersonation.05: an impersonation session is re-checked on EVERY request, not only when it starts. It ends (401
 * SESSION_REVOKED, the client goes to sign-in) as soon as:
 *  - the impersonator cannot be read, is not the one recorded in the session, or is no longer ACTIVE;
 *  - a system-flow impersonator is no longer a platform ADMIN, or a tenant-flow impersonator is no longer an ACTIVE
 *    OWNER / ADMIN of the tenant;
 *  - the target's membership of the tenant is no longer ACTIVE (a tenant-flow target must still be a member at all).
 * `impersonatedBy` is the impersonator's user row as the session reader loaded it fresh for this request.
 */
export async function assertImpersonationStanding(args: {
  tenantId: string;
  targetUserId: string;
  impersonation: { impersonatorUserId?: string; flow?: string };
  impersonatedBy: SafeUser | null | undefined;
  getMembership: (tenantId: string, userId: string) => Promise<SafeTenantMember | null>;
}): Promise<void> {
  const { tenantId, targetUserId, impersonation, impersonatedBy, getMembership } = args;
  const end = (): never => { throw new AppError(UserSessionMessages.SESSION_REVOKED, 401, ErrorCode.UNAUTHORIZED); };

  if (!impersonatedBy || impersonatedBy.userStatus !== 'ACTIVE') end();
  const operator = impersonatedBy as SafeUser;
  if (impersonation.impersonatorUserId && operator.userId !== impersonation.impersonatorUserId) end();

  // Sessions minted before the flow was recorded: a platform ADMIN impersonator is the system flow.
  const systemFlow = impersonation.flow === 'system' || (impersonation.flow === undefined && operator.userRole === 'ADMIN');
  if (systemFlow) {
    if (operator.userRole !== 'ADMIN') end();
  } else {
    const own = await getMembership(tenantId, operator.userId);
    if (!own || String(own.memberStatus) !== 'ACTIVE' || !TENANT_IMPERSONATOR_ROLES.has(String(own.memberRole))) end();
  }

  const target = await getMembership(tenantId, targetUserId);
  if (target ? String(target.memberStatus) !== 'ACTIVE' : !systemFlow) end();
}
