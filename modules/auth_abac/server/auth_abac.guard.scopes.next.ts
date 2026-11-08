import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import TenantSessionNextService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service.next';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { UserRole } from '@kuraykaraaslan-labs/user/server/user.enums';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import type { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import type { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import type {
  AuthorizeRequestBase,
  PublicAuthResult,
  AccountAuthResult,
} from './auth_abac.guard.types';
import {
  enforcePermission, normalizeAuthError, requireTenantId, tenantFloorOf, PASSWORD_CHANGE_STEP_PERMISSIONS, SESSION_STEP_UP_PERMISSIONS,
} from './auth_abac.guard.core.next';
import { authenticateTenantAtPermissionFloor } from './auth_abac.guard.group-floor.next';
import { authorizeTenantByApiKey, carriesApiKey } from './auth_abac.guard.api-key.next';
import { authorizeTenantByMcpGrant, carriesMcpGrant } from './auth_abac.guard.mcp-grant.next';

// The scope helpers and the bulk resolver live in sibling files; re-exported so
// this stays the one import point the guard (and its tests) already use.
export { deriveScope } from './auth_abac.guard.core.next';
export { grantedPermissions } from './auth_abac.guard.granted.next';

/**
 * TENANT path: authenticate ONCE at the permission's coarse role floor (preserving
 * all tenant-session logic — membership, global-admin, impersonation, the
 * PERMISSION_DENIED audit), then evaluate the permission on the resolved session.
 *
 * A custom group may lift an ADMIN-floor permission over the member's built-in role
 * (group-floor.next.ts); every other route, and a route that names its own role,
 * authenticates at the floor exactly as before.
 */
export async function authorizeTenant(args: AuthorizeRequestBase & { tenantId?: string }): Promise<TenantAuthResult> {
  const tenantId = requireTenantId(args.tenantId);
  // docs/phases/48-api-key-scopes D48-1: a `Bearer sk_…` request is judged only as that API key (auth_abac.guard.api-key.next).
  // docs/phases/57-mcp-server D57-8: a `Bearer mcp_at_…` request is judged only as that grant, and only where the route opts in.
  if (carriesMcpGrant(args.request)) return authorizeTenantByMcpGrant(args, tenantId);
  if (carriesApiKey(args.request)) return authorizeTenantByApiKey(args, tenantId);
  const auth = await authenticateTenantAtPermissionFloor({
    request: args.request,
    tenantId,
    requiredPermission: args.requiredPermission,
    floor: tenantFloorOf(args.requiredPermission),
    explicitRole: args.requiredTenantRole,
  });
  await enforcePermission(args, tenantId, {
    user: auth.user,
    tenantMember: auth.tenantMember,
    userSession: auth.userSession,
    isGlobalAdmin: auth.isGlobalAdmin,
  });
  return auth;
}

/**
 * GUEST path: resolve the caller's identity OPTIONALLY (a thrown auth error is
 * swallowed → anonymous), build a GUEST-capable subject, and evaluate the
 * permission. Only throws on an explicit ABAC policy `deny` (and not under shadow mode).
 */
export async function authorizeGuest(args: AuthorizeRequestBase & { tenantId?: string }): Promise<PublicAuthResult> {
  const tenantId = requireTenantId(args.tenantId);
  let user: SafeUser | null = null;
  let tenantMember: SafeTenantMember | null = null;
  let tenant: SafeTenant | null = null;
  let isGlobalAdmin: boolean | undefined;
  let userSession: SafeUserSession | null = null;
  try {
    // Optional identity — use the full tenant auth and treat a throw as anonymous,
    // so a logged-in caller still yields a server-trusted user.
    const auth = await TenantSessionNextService.authenticateTenantByRequest({
      request: args.request,
      tenantId,
    });
    user = auth.user;
    tenantMember = auth.tenantMember;
    tenant = auth.tenant;
    isGlobalAdmin = auth.isGlobalAdmin;
    userSession = auth.userSession;
  } catch {
    // Anonymous, or a logged-in non-member — proceed as GUEST. Never rethrow.
  }

  await enforcePermission(args, tenantId, { user, tenantMember, userSession, isGlobalAdmin });
  return { user, tenantMember, tenant, isGlobalAdmin };
}

/**
 * ROOT path: super-admin = a member of the root tenant. Authenticates
 * against `ROOT_TENANT_ID` with `allowGlobalAdmin:false` (the root tenant IS the
 * super-admin scope), then evaluates the permission on that session.
 */
export async function authorizeRoot(args: AuthorizeRequestBase & { tenantId?: string }): Promise<TenantAuthResult> {
  const requiredRole = args.requiredTenantRole ?? 'ADMIN';
  let auth: TenantAuthResult;
  try {
    auth = await TenantSessionNextService.authenticateRootTenantAdmin({
      request: args.request,
      requiredRole,
    });
  } catch (err) {
    normalizeAuthError(err);
  }
  await enforcePermission(args, ROOT_TENANT_ID, { user: auth.user, tenantMember: auth.tenantMember, userSession: auth.userSession });
  return auth;
}

/**
 * ACCOUNT path: authenticate a logged-in user from the user session (NO tenant
 * membership required), then evaluate the permission against the platform
 * (`ROOT_TENANT_ID`) policy set with the subject role taken from `user.userRole`.
 * The heavy user-session service is loaded lazily so callers/tests that never use
 * this scope don't pull it in at module load.
 */
/**
 * auth.13: the permissions of the sign-in's own one-time-code step. The session that still owes its second factor must reach
 * exactly these (to ask for a code and to prove it); every other route keeps refusing it 401 OTP_REQUIRED. The routes behind
 * them accept only `action: 'authenticate'` from such a session (auth-otp-send / auth-otp-verify).
 */
export const OTP_STEP_PERMISSIONS: ReadonlySet<string> = new Set(['auth.me.otp.send', 'auth.me.otp.verify']);

export async function authorizeAccount(
  args: AuthorizeRequestBase & { tenantId?: string; requiredUserRole?: UserRole },
): Promise<AccountAuthResult> {
  const { default: UserSessionNextService } = await import(
    '@kuraykaraaslan-labs/user_session/server/user_session.service.next'
  );
  let auth: { user: SafeUser; userSession: SafeUserSession };
  try {
    auth = await UserSessionNextService.authenticateUserByRequest({
      request: args.request,
      requiredUserRole: args.requiredUserRole ?? 'USER',
      otpVerifyBypass: OTP_STEP_PERMISSIONS.has(args.requiredPermission),
      passwordChangeBypass: PASSWORD_CHANGE_STEP_PERMISSIONS.has(args.requiredPermission),
      sessionStepUpBypass: SESSION_STEP_UP_PERMISSIONS.has(args.requiredPermission),
    });
  } catch (err) {
    normalizeAuthError(err);
  }
  await enforcePermission(args, ROOT_TENANT_ID, {
    user: auth.user,
    tenantMember: null,
    userSession: auth.userSession,
    userRole: auth.user.userRole,
  });
  return { user: auth.user, userSession: auth.userSession, tenant: null, tenantMember: null };
}

/**
 * GLOBAL path: root-tenant super-admin behind the KD-13 admin gate (IP allowlist
 * + MFA), via `authenticateAdminRequest`. That guard returns a `{ ok, response }`
 * union rather than throwing, so we surface its status as a status-carrying
 * AppError — keeping the "no dedicated try/catch in the route" contract. The auth
 * module is loaded lazily to avoid a static abac→auth dependency at module load.
 */
export async function authorizeGlobal(args: AuthorizeRequestBase & { tenantId?: string }): Promise<TenantAuthResult> {
  const { authenticateAdminRequest } = await import('@kuraykaraaslan-labs/auth/server/auth.admin-guard.next');
  const auth = await authenticateAdminRequest(args.request, {
    requiredRole: args.requiredTenantRole ?? 'ADMIN',
  });
  if (!auth.ok) {
    // Phase 55 00.6: a refusal that asks for a step-up (a step-up forced on the session) keeps its `details.stepUp`, so the client can answer it.
    if (auth.error) throw auth.error;
    const status = auth.response.status;
    throw new AppError(MSG.FORBIDDEN, status, status === 401 ? ErrorCode.UNAUTHORIZED : ErrorCode.FORBIDDEN);
  }
  await enforcePermission(args, ROOT_TENANT_ID, {
    user: auth.user,
    tenantMember: auth.tenantMember,
    userSession: auth.userSession,
    userRole: auth.user.userRole,
    isGlobalAdmin: true,
  });
  return {
    user: auth.user,
    userSession: auth.userSession,
    tenant: auth.tenant,
    tenantMember: auth.tenantMember,
    isGlobalAdmin: true,
  };
}
