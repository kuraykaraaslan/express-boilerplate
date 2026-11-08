import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * Central login: the root tenant's sign-in page is everybody's front door, not only the platform staff's.
 *
 * On any other tenant, signing in (and finishing the one-time code of that sign-in) needs an ACTIVE membership of it,
 * as before. On the root tenant a person who is not a root member signs in with an ACCOUNT-ONLY session
 * (`tenantMember: null`): to pick one of their tenants, or, with none yet (a platform sign-up), to open one in the
 * onboarding (auth.registration.ts). That session carries no root role, so
 * every tenant-scoped check on the root tenant refuses it like an anonymous visitor's; it can read the caller's own
 * account (`scope: 'ACCOUNT'` routes: /api/auth/me/*, the tenant list) and exchange itself for a session in one of
 * their tenants (/api/auth/session/exchange, which checks that membership). The admin shell sends it to the tenant
 * picker. Nobody becomes a root member by signing in.
 */
export type LoginMembership = {
  /** The membership of the tenant signed in to; null for an account-only root session. */
  tenantMember: SafeTenantMember | null;
};

export const NOT_A_MEMBER_MESSAGE = 'You are not a member of this organization';

/**
 * Who may sign in to `tenantId` (and complete that sign-in's one-time code): an ACTIVE member, or, on the root tenant
 * only, anybody who is not a root member at all (account-only). Anybody else: 403 NOT_TENANT_MEMBER. The account's own
 * status (suspended, locked, unverified) is the login service's to refuse, before this runs.
 */
export async function resolveLoginMembership(tenantId: string, userId: string): Promise<LoginMembership> {
  const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId });
  if (tenantMember?.memberStatus === 'ACTIVE') return { tenantMember };
  // A suspended or pending root member is refused like on any tenant: their own status decides, not other tenants.
  if (isRootTenant(tenantId) && !tenantMember) return { tenantMember: null };
  // `noMembership`: the account has no row here at all (as opposed to a suspended or pending one). A sign-in route answers that
  // exactly like a wrong password (F.auth.04), so a tenant the account does not belong to cannot use its sign-in page to test passwords.
  throw new AppError(NOT_A_MEMBER_MESSAGE, 403, ErrorCode.NOT_TENANT_MEMBER, tenantMember ? undefined : { details: { noMembership: true } });
}

/** Did `resolveLoginMembership` refuse because the account has no membership row in the tenant at all? */
export function isNoMembershipRefusal(e: unknown): boolean {
  return e instanceof AppError && e.code === ErrorCode.NOT_TENANT_MEMBER && e.details?.noMembership === true;
}
