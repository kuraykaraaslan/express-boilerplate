import type { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import type { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';

/**
 * The result of `authenticateTenantByRequest` — the fully-resolved tenant session
 * a route handler receives. Named here so guards that wrap the authenticator
 * (e.g. auth_abac `authorizeRequest`) can return the exact same shape as a
 * drop-in replacement. Structurally identical to the authenticator's inline
 * return type.
 */
export interface TenantAuthResult {
  user: SafeUser;
  userSession: SafeUserSession;
  tenant: SafeTenant;
  tenantMember: SafeTenantMember;
  isGlobalAdmin?: boolean;
  isImpersonating?: boolean;
  impersonatedBy?: SafeUser;
  /**
   * The tenant's IP allow/deny lists did not apply to this caller (`exemptFromIpLists`: a platform admin, a
   * system-flow impersonation, a break-glass session for this tenant). The settings write guard uses it as its own
   * exemption, so it never refuses a list to a caller the lists never meet.
   */
  ipListsExempt?: boolean;
  /**
   * The request was made with an API key (docs/phases/48-api-key-scopes D48-2): `user` and `tenantMember` are the key's holder
   * and `userSession` is a stand-in for this one request (`userSessionId` is the key's id; no token behind it).
   */
  apiKey?: { apiKeyId: string; name: string };
  /**
   * The request was made with an MCP OAuth access token (docs/phases/57-mcp-server D57-8) on a route that accepts one: `user` and
   * `tenantMember` are the person who consented; `userSession` is a stand-in for this one request (`userSessionId` is the grant's id).
   */
  mcpGrant?: { grantId: string; clientId: string; clientHost: string; resource: string; scope: string };
}

/** Typed tenant-session context propagated to route handlers. */
export interface TenantSessionContext {
  tenant: SafeTenant;
  tenantMember: SafeTenantMember;
  user: SafeUser;
  role: TenantMemberRole;
}

/** Optional per-request signals for session-resolution security checks. */
export interface TenantSessionRequestContext {
  ip?: string | null;
  userAgent?: string | null;
  /** Whether the user has satisfied MFA this session (drives 2FA enforcement). */
  mfaVerified?: boolean;
  /** ISO country of the request IP, when known (geo anomaly detection). */
  country?: string | null;
  /** The session id of the request (MS-36: the concurrent-session cap is enforced when a session is issued, user_session `enforceSessionCap`, not per request). */
  sessionId?: string | null;
  /**
   * The caller enforces the tenant's IP allow/deny lists itself, with its exemptions (authenticateTenantByRequest:
   * `exemptFromIpLists`, after the membership decision), so the membership resolver must not check them a second time.
   */
  ipListsHandled?: boolean;
}
