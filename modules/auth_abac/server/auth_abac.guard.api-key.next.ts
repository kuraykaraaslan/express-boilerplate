import type { NextRequest } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { API_KEY_BEARER } from '@kuraykaraaslan-labs/common/server/lane';
import TenantSessionService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service';
import { trustedClientIp } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.client-ip';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import type { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import type { AuthorizeRequestBase } from './auth_abac.guard.types';
import { enforcePermission, FLOOR_RANK, normalizeAuthError, tenantFloorOf } from './auth_abac.guard.core.next';
import { meetsFloorOrGroup } from './auth_abac.guard.group-floor.next';
import { markKeyRequest } from './auth_abac.key-requests';

// ── The key lane of the TENANT path (docs/phases/48-api-key-scopes D48-1, D48-2, D48-4) ──────────────────────────────────
// A request whose `Authorization` is `Bearer sk_live_…` / `sk_test_…` is judged ONLY as that key, never by a cookie it may also
// carry (the request lanes' L-1). The key must hold the route's permission; the key's holder (its creator, or the OWNER who
// marked a service key whose creator left) must hold it now: their role floor or a group / config/access.ts lift of an ADMIN
// floor, and the PDP as for their session (tenant policies, config/access.ts removals, the route's resource). So the key can
// do at most what its holder can do today (lead decision D12). ROOT, GLOBAL, ACCOUNT and GUEST paths never accept a key.
// Review fixes: the tenant's own IP allow / deny lists bind a key as they bind its holder's session; the holder acts with
// at most an ADMIN's role (an OWNER-only branch a route takes on `memberRole` is no key's, D48-3); the stand-in session
// opens no socket (websocket.session-binding); a refusal on the holder's side is audited like the key's own.

/** Does this request present an API key in its `Authorization` header? */
export function carriesApiKey(request: { headers?: { get?: (name: string) => string | null } } | null | undefined): boolean {
  // Read defensively: an internal caller may hand the guard a request-like object without headers (never a key, then).
  return API_KEY_BEARER.test((request?.headers?.get?.('authorization') ?? '').trim());
}

const REFUSED = () => new AppError('Invalid or expired API key.', 401, ErrorCode.UNAUTHORIZED);
const FORBIDDEN = () => new AppError(MSG.FORBIDDEN, 403, ErrorCode.FORBIDDEN);

const loadKeyLane = (tenantId: string) => ifActive(tenantId, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.principal'));
type KeyLane = NonNullable<Awaited<ReturnType<typeof loadKeyLane>>>;

export async function authorizeTenantByApiKey(args: AuthorizeRequestBase, tenantId: string): Promise<TenantAuthResult> {
  // api_key switched off for the tenant (or absent from the build): no key works here, like an unknown key.
  const mod = await loadKeyLane(tenantId);
  if (!mod) throw REFUSED();
  try {
    return await keyLane(mod, args, tenantId);
  } catch (err) {
    // A route may run the guard once per permission it checks: a refusal by any of those calls means the request was not let
    // through, so a use an earlier call of it recorded is dropped (api_key.principal `markKeyRefused`).
    mod.markKeyRefused(args.request);
    throw err;
  }
}

async function keyLane(mod: KeyLane, args: AuthorizeRequestBase, tenantId: string): Promise<TenantAuthResult> {
  // The tenant's IP allow / deny lists protect the tenant's data from every member path (tenant_session.ip-exempt); a key
  // acts as a member. Checked before the key is verified, so a blocked address cannot spend the key's rate limit either.
  try {
    await TenantSessionService.assertIpAllowed(tenantId, trustedClientIp(args.request));
  } catch (err) {
    normalizeAuthError(err);
  }

  let principal: Awaited<ReturnType<KeyLane['resolveKeyPrincipal']>>;
  try {
    principal = await mod.resolveKeyPrincipal(args.request, tenantId, args.requiredPermission);
  } catch (err) {
    // A refusal the key may know (IP, permission), the rate limit and an outage keep their answer; anything else about the
    // key is the one 401 an unknown key gets, so a caller cannot tell an inactive key from a wrong one.
    if (err instanceof AppError && (err.statusCode === 403 || err.statusCode === 429 || err.statusCode === 503)) throw err;
    throw REFUSED();
  }
  const { key, holderUserId } = principal;
  const refuse: (reason: string) => never = (reason) => {
    mod.auditKeyRefusal(args.request, key, reason);
    throw FORBIDDEN();
  };

  let tenant: TenantAuthResult['tenant'] | null;
  let member: TenantAuthResult['tenantMember'] | null;
  let user: SafeUser;
  try {
    [tenant, member] = await Promise.all([
      TenantSessionService.getTenantById(tenantId),
      TenantSessionService.getTenantMembership(tenantId, holderUserId),
    ]);
    if (!tenant) throw REFUSED();
    TenantSessionService.validateTenantStatus(tenant);
    const { getById } = await import('@kuraykaraaslan-labs/user/server/user.read.service');
    user = await getById(holderUserId);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) refuse('holder_not_found');
    normalizeAuthError(err);
  }
  if (!tenant || !member || member.memberStatus !== 'ACTIVE' || user.userStatus !== 'ACTIVE') refuse('holder_inactive');
  // An OWNER's key acts with an ADMIN's role: no key holds an OWNER power (D48-3), and that includes what a route allows
  // only when `memberRole` is OWNER (tenant_branding's custom JS, the OWNER-only setting keys).
  const actingMember = (member.memberRole === 'OWNER' ? { ...member, memberRole: 'ADMIN' } : member) as NonNullable<TenantAuthResult['tenantMember']>;

  // The holder's role floor, exactly as the session path applies it: a route's own requiredTenantRole, else the
  // permission's floor, which a custom group or a config/access.ts grant may lift when it is ADMIN.
  const holds = args.requiredTenantRole
    ? FLOOR_RANK[actingMember.memberRole as TenantMemberRole] >= FLOOR_RANK[args.requiredTenantRole]
    : await meetsFloorOrGroup(tenantId, actingMember, args.requiredPermission, tenantFloorOf(args.requiredPermission));
  if (!holds) refuse('holder_insufficient_permission');

  // A later grantedPermissions on this request answers within the key's own list (auth_abac.key-requests).
  markKeyRequest(args.request, principal.usablePermissions);
  await enforcePermission(args, tenantId, { user, tenantMember: actingMember, userSession: null, isGlobalAdmin: false });
  // Only a call the guard let through is a use of the key (a refused one leaves its row untouched).
  mod.recordKeyUse(args.request, key);

  // The handler gets the holder; the session is a stand-in for this one request, with no token behind it.
  const userSession = {
    userSessionId: key.apiKeyId,
    userId: holderUserId,
    tenantId,
    userAgent: args.request.headers.get('user-agent'),
    ipAddress: null,
    sessionStatus: 'ACTIVE',
    otpVerifyNeeded: false,
    sessionExpiry: key.expiresAt ?? new Date(Date.now() + 60_000),
    createdAt: key.createdAt,
    updatedAt: key.updatedAt,
    metadata: { apiKeyId: key.apiKeyId },
  } as unknown as SafeUserSession;
  const request = args.request as NextRequest;
  request.tenant = tenant;
  request.tenantMember = actingMember;
  return { user, userSession, tenant, tenantMember: actingMember, isGlobalAdmin: false, apiKey: { apiKeyId: key.apiKeyId, name: key.name } };
}
