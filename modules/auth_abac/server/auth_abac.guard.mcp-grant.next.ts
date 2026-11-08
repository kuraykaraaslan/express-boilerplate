// ── The MCP grant lane of the TENANT path (docs/phases/57-mcp-server D57-8) ──────────────────────────────────────────────────
// A request whose `Authorization` is `Bearer mcp_at_…` (an access token of mcp_server's OAuth authorization server) is judged ONLY as
// that grant, never by a cookie it may also carry (L-1), and ONLY on a route that opts in with `allowMcpGrant` (the MCP servers):
// everywhere else the same token is a 401, so an MCP token can never reach the platform's other APIs. The grant acts as the person
// who consented, and at most what that person may do now: the same holder checks as an API key's (membership and user ACTIVE, the
// tenant IP lists, the role floor with group / config/access.ts lifts, the PDP), an OWNER acting with an ADMIN's role.
import type { NextRequest } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { MCP_GRANT_BEARER } from '@kuraykaraaslan-labs/common/server/lane';
import TenantSessionService from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.service';
import { trustedClientIp } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.client-ip';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import type { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import type { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import type { AuthorizeRequestBase } from './auth_abac.guard.types';
import { AUTH_ABAC_MESSAGES as MSG } from './auth_abac.messages';
import { enforcePermission, FLOOR_RANK, normalizeAuthError, tenantFloorOf } from './auth_abac.guard.core.next';
import { meetsFloorOrGroup } from './auth_abac.guard.group-floor.next';

/** Does this request present an MCP grant token in its `Authorization` header? */
export function carriesMcpGrant(request: { headers?: { get?: (name: string) => string | null } } | null | undefined): boolean {
  return MCP_GRANT_BEARER.test((request?.headers?.get?.('authorization') ?? '').trim());
}

const REFUSED = () => new AppError('Invalid or expired access token', 401, ErrorCode.UNAUTHORIZED);
const FORBIDDEN = () => new AppError(MSG.FORBIDDEN, 403, ErrorCode.FORBIDDEN);

const loadGrantLane = (tenantId: string) =>
  ifActive(tenantId, 'mcp_server', () => import('@kuraykaraaslan-labs/mcp_server/server/mcp_server.grant-principal'));

export async function authorizeTenantByMcpGrant(args: AuthorizeRequestBase, tenantId: string): Promise<TenantAuthResult> {
  // The route did not opt in: an MCP token is no credential here.
  if (!args.allowMcpGrant) throw REFUSED();
  const mod = await loadGrantLane(tenantId);
  if (!mod) throw REFUSED();
  const ip = trustedClientIp(args.request);
  try {
    await TenantSessionService.assertIpAllowed(tenantId, ip);
  } catch (err) {
    normalizeAuthError(err);
  }
  const grant = await mod.resolveGrantPrincipal(args.request, tenantId, ip ?? null);

  let tenant: TenantAuthResult['tenant'] | null;
  let member: TenantAuthResult['tenantMember'] | null;
  let user: SafeUser;
  try {
    [tenant, member] = await Promise.all([
      TenantSessionService.getTenantById(tenantId),
      TenantSessionService.getTenantMembership(tenantId, grant.userId),
    ]);
    if (!tenant) throw REFUSED();
    TenantSessionService.validateTenantStatus(tenant);
    const { getById } = await import('@kuraykaraaslan-labs/user/server/user.read.service');
    user = await getById(grant.userId);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) throw FORBIDDEN();
    normalizeAuthError(err);
  }
  if (!tenant || !member || member.memberStatus !== 'ACTIVE' || user.userStatus !== 'ACTIVE') throw FORBIDDEN();
  const actingMember = (member.memberRole === 'OWNER' ? { ...member, memberRole: 'ADMIN' } : member) as NonNullable<TenantAuthResult['tenantMember']>;

  const holds = args.requiredTenantRole
    ? FLOOR_RANK[actingMember.memberRole as TenantMemberRole] >= FLOOR_RANK[args.requiredTenantRole]
    : await meetsFloorOrGroup(tenantId, actingMember, args.requiredPermission, tenantFloorOf(args.requiredPermission));
  if (!holds) throw FORBIDDEN();
  await enforcePermission(args, tenantId, { user, tenantMember: actingMember, userSession: null, isGlobalAdmin: false });

  const userSession = {
    userSessionId: grant.grantId,
    userId: grant.userId,
    tenantId,
    userAgent: args.request.headers.get('user-agent'),
    ipAddress: null,
    sessionStatus: 'ACTIVE',
    otpVerifyNeeded: false,
    sessionExpiry: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { mcpGrantId: grant.grantId },
  } as unknown as SafeUserSession;
  const request = args.request as NextRequest;
  request.tenant = tenant;
  request.tenantMember = actingMember;
  return {
    user, userSession, tenant, tenantMember: actingMember, isGlobalAdmin: false,
    mcpGrant: { grantId: grant.grantId, clientId: grant.clientId, clientHost: grant.clientHost, resource: grant.resource, scope: grant.scope },
  };
}
