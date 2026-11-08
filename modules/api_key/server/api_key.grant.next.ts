import type { NextRequest } from 'next/server';
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';

/**
 * Which of these permissions the caller of a key-management route holds now (docs/phases/48-api-key-scopes D12, D48-5): the
 * ceiling of what they may give a key. The same answer the menu and the guard give (role floor, groups, config/access.ts, the
 * policies), from the session the route already authenticated. A caller that is itself an API key gives nothing; nor does
 * an impersonator or a global admin (review fix): their rights are borrowed for a session, and a key outlives it by up to a
 * year as a credential of the member it names (the display links refuse them for the same reason).
 */
export async function heldPermissions(request: NextRequest, tenantId: string, auth: TenantAuthResult, permissionIds: string[]): Promise<Set<string>> {
  if (auth.apiKey || auth.isImpersonating || auth.isGlobalAdmin || permissionIds.length === 0) return new Set();
  return grantedPermissions({
    request,
    tenantId,
    permissionIds,
    session: { user: auth.user, tenantMember: auth.tenantMember, userSession: auth.userSession, isGlobalAdmin: auth.isGlobalAdmin },
  });
}
