import { NextRequest } from 'next/server';
import { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import { SafeTenant } from '@kuraykaraaslan-labs/tenant/server/tenant.types';
import { SafeTenantMember } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.types';
import { SafeUserSession, type SessionMeta } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import UserSessionNextService from '@kuraykaraaslan-labs/user_session/server/user_session.service.next';
import TenantSessionService from './tenant_session.service';
import TenantAuthMessages from './tenant_session.messages';
import type { TenantMemberRole } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import ObservabilityService from '@kuraykaraaslan-labs/observability';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { extractTenantId, type TenantIdSource } from './tenant_session.extract.next';
import { GLOBAL_ADMIN_MEMBER_ID_PREFIX, globalAdminBypassAllowed } from './tenant_session.global-admin';
import { trustedClientIp } from './tenant_session.client-ip';
import { exemptFromIpLists } from './tenant_session.ip-exempt';
import { auditGlobalAdminAccess } from './tenant_session.global-admin-audit';
import { assertImpersonationStanding } from './tenant_session.impersonation';
import { env } from '@kuraykaraaslan-labs/env';
import type { TenantAuthResult, TenantSessionRequestContext } from './tenant_session.types';
import { amrHasSecondFactor } from '@kuraykaraaslan-labs/user_session/server/user_session.amr';

/**
 * Authenticate user and verify tenant membership with required role
 * Global admins (userRole === 'ADMIN') bypass tenant membership check, except on a fleet node (tenant_session.global-admin.ts)
 * @param request - The Next.js request object
 * @param requiredTenantRole - The required tenant role
 * @param tenantIdSource - Where to extract tenant ID from
 * @param tenantId - Optional direct tenant ID (overrides source extraction)
 * @param otpVerifyBypass - Whether to bypass OTP verification for user auth
 * @param passwordChangeBypass - auth.05: the route is part of the forced change-password step
 * @param allowGlobalAdmin - Whether to allow global admins to bypass tenant membership (default: true)
 * @param refuseNonMember - The guard's TENANT path sets it: a caller with NO membership here is answered as the ordinary
 *   403 not-a-member refusal (denial recorded), whatever tenant their session was minted for, instead of the 401 session mismatch
 * @returns The authenticated user, session, tenant, and tenant member (or virtual member for global admin)
 */
async function authenticateTenantByRequestInner({
  request,
  requiredTenantRole = 'USER',
  tenantIdSource,
  tenantId: directTenantId,
  otpVerifyBypass = false,
  passwordChangeBypass = false,
  sessionStepUpBypass = false,
  allowGlobalAdmin = true,
  refuseNonMember = false,
}: {
  request: NextRequest;
  requiredTenantRole?: TenantMemberRole;
  tenantIdSource?: TenantIdSource;
  tenantId?: string;
  otpVerifyBypass?: boolean;
  passwordChangeBypass?: boolean;
  sessionStepUpBypass?: boolean;
  allowGlobalAdmin?: boolean;
  refuseNonMember?: boolean;
}): Promise<TenantAuthResult> {
  // Step 1: Authenticate user first (also populates request.isImpersonating / request.impersonatedBy)
  const { user, userSession } = await UserSessionNextService.authenticateUserByRequest({
    request,
    requiredUserRole: 'USER',
    otpVerifyBypass,
    passwordChangeBypass,
    sessionStepUpBypass,
  });

  // Step 2: Get tenant ID
  // S17: the tenant comes from the route (an explicit id) or an explicitly chosen source, never from the client-writable
  // `x-tenant-id` header by default: a header source is honoured only when the caller asks for it by name.
  const tenantId = directTenantId || (tenantIdSource ? extractTenantId(request, tenantIdSource) : null);

  if (!tenantId) {
    throw new Error(TenantAuthMessages.TENANT_ID_REQUIRED);
  }

  // Step 3: Impersonation takes precedence — use targetTenantRole from session metadata
  const meta = userSession.metadata as SessionMeta | null | undefined;
  const impersonation = meta?.impersonation;

  // A break-glass session (fleet 04 §6): refuse it past its grant window even if the row is still there, and tag every audit row this request writes with the
  // grant. Best-effort for the tag (provenance must not fail the request); the expiry check is not.
  if (meta?.breakGlass) {
    if (Date.parse(meta.breakGlass.expiresAt) <= Date.now()) throw new AppError('The break-glass window has ended', 401, ErrorCode.SESSION_EXPIRED);
    await import('@kuraykaraaslan-labs/audit_log/server/audit_log.context')
      .then(({ markBreakGlassRequest }) => markBreakGlassRequest(meta.breakGlass!.grantId, tenantId))
      .catch(() => false);
  }

  // The tenant's IP allow/deny lists (`ipWhitelist` / `ipBlacklist`) meet every path below once it has decided the
  // request may otherwise pass, so a refusal never replaces the audited membership / role denial it would have got
  // anyway. Who is exempt is `exemptFromIpLists` (tenant_session.ip-exempt.ts); every result reports it as
  // `ipListsExempt`, which the settings write guard uses as its own exemption.
  const extReq = request as NextRequest & { isImpersonating?: boolean; impersonatedBy?: SafeUser };
  const ipListsExempt = exemptFromIpLists({ user, userSession, tenantId, impersonatedBy: extReq.impersonatedBy });
  const assertIp = () => TenantSessionService.assertIpAllowed(tenantId, trustedClientIp(request));

  if (impersonation && impersonation.tenantId === tenantId && impersonation.targetTenantRole) {
    const tenant = await TenantSessionService.getTenantById(tenantId);
    if (!tenant) throw new Error(TenantAuthMessages.TENANT_NOT_FOUND);
    TenantSessionService.validateTenantStatus(tenant);

    const role = impersonation.targetTenantRole as TenantMemberRole;

    if (!TenantSessionService.hasRequiredRole(role, requiredTenantRole)) {
      throw new Error(TenantAuthMessages.INSUFFICIENT_TENANT_PERMISSIONS);
    }

    const isImpersonating = !!extReq.isImpersonating;
    const impersonatedBy = extReq.impersonatedBy;

    // auth_impersonation.05: the impersonator and the target are re-checked on every request; either one gone ends it.
    await assertImpersonationStanding({
      tenantId,
      targetUserId: user.userId,
      impersonation: impersonation as { impersonatorUserId?: string; flow?: string },
      impersonatedBy,
      getMembership: (t, u) => TenantSessionService.getTenantMembership(t, u),
    });

    if (!ipListsExempt) await assertIp();

    const virtualMember: SafeTenantMember = {
      tenantMemberId: `impersonation-${userSession.userSessionId}`,
      tenantId,
      userId: user.userId,
      memberRole: role,
      // An impersonation carries the built-in role it was granted and NO custom
      // groups: impersonating somebody must not silently hand the operator that
      // person's bespoke permission sets too.
      roleKeys: [],
      memberStatus: 'ACTIVE',
      sessionVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    request.tenant = tenant;
    request.tenantMember = virtualMember;

    ObservabilityService.setTags({ tenantId, userId: user.userId });
    return { user, userSession, tenant, tenantMember: virtualMember, isGlobalAdmin: false, isImpersonating, impersonatedBy, ipListsExempt };
  }

  // Step 4: Check if user is global admin
  // never on a fleet node: there a customer tenant is reached through a membership or a break-glass grant (tenant_session.global-admin.ts)
  const isGlobalAdmin = allowGlobalAdmin && globalAdminBypassAllowed(env.FLEET_ROLE) && user.userRole === 'ADMIN';

  if (isGlobalAdmin) {
    // Global admin bypass - just get the tenant without membership check,
    // but still enforce tenant status (SUSPENDED/INACTIVE blocks even root admins
    // — a suspended tenant must be fully frozen, no admin escape hatch).
    const tenant = await TenantSessionService.getTenantById(tenantId);

    if (!tenant) {
      throw new Error(TenantAuthMessages.TENANT_NOT_FOUND);
    }

    TenantSessionService.validateTenantStatus(tenant);

    // Create a virtual tenant member for global admin with OWNER privileges
    const virtualTenantMember: SafeTenantMember = {
      tenantMemberId: `${GLOBAL_ADMIN_MEMBER_ID_PREFIX}${user.userId}`,
      tenantId: tenant.tenantId,
      userId: user.userId,
      memberRole: 'OWNER',
      // A platform admin is OWNER by construction; custom groups are a tenant's
      // own vocabulary and mean nothing to a virtual member.
      roleKeys: [],
      memberStatus: 'ACTIVE',
      sessionVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    request.tenant = tenant;
    request.tenantMember = virtualTenantMember;

    ObservabilityService.setTags({ tenantId, userId: user.userId });
    auditGlobalAdminAccess({
      userId: user.userId, userSessionId: userSession.userSessionId, tenantId: tenant.tenantId,
      ipAddress: trustedClientIp(request), method: request.method, path: request.nextUrl?.pathname,
    });
    return { user, userSession, tenant, tenantMember: virtualTenantMember, isGlobalAdmin: true, ipListsExempt };
  }

  // The session itself is tenant-scoped (one UserSession per tenant
  // membership) — a token minted for tenant A must never authorize a request
  // against tenant B, even if the same user also happens to be a member of B.
  // Global admins and a matched impersonation already returned above, so this
  // only ever rejects an ordinary member's session presented to the wrong
  // tenant (e.g. a stale cookie sent across `/t/{tenantId}` paths in path-mode).
  //
  // `refuseNonMember` (the guard's TENANT path) lets a caller with NO membership row here fall through to the ordinary
  // not-a-member 403 and its recorded denial, instead of the 401 below: a session for another tenant is no reason to
  // tell a stranger to sign in again. A caller who IS a member here (any status) must present a session minted for this
  // tenant (S1: a member of two tenants must not use one tenant's token on the other). A failing membership lookup
  // propagates: fail closed.
  if (userSession.tenantId !== tenantId) {
    const memberHere = refuseNonMember ? await TenantSessionService.getTenantMembership(tenantId, user.userId) : null;
    if (!refuseNonMember || memberHere) {
      throw new AppError(TenantAuthMessages.SESSION_TENANT_MISMATCH, 401, ErrorCode.UNAUTHORIZED);
    }
  }

  // Step 4: Authenticate tenant membership using core service (for non-global-admins)
  // An account-only session (central login on the root tenant, auth.central-login.ts) is a non-member here by
  // construction: refusing it is the expected answer, not a probe, so it neither ticks the tenant's auth-failure breaker
  // (50 a minute would lock the root tenant's sign-in for everybody) nor writes a PERMISSION_DENIED row per request.
  const accountOnly = meta?.accountOnly === true;
  let tenant: SafeTenant;
  let tenantMember: SafeTenantMember;
  try {
    // S2: the tenant's own security settings (auth-failure breaker, `twoFactorRequired`) are read
    // only with a request context; no caller passed one, so they were dead. The IP lists stay here (with their exemptions).
    const context: TenantSessionRequestContext = {
      ip: trustedClientIp(request),
      userAgent: request.headers.get('user-agent'),
      mfaVerified: amrHasSecondFactor(meta?.amr),
      sessionId: userSession.userSessionId,
      ipListsHandled: true,
    };
    const result = await TenantSessionService.authenticateTenantMembership({
      user,
      tenantId,
      requiredRole: requiredTenantRole,
      context,
      deferNotMember: refuseNonMember || accountOnly,
    });
    tenant = result.tenant;
    tenantMember = result.tenantMember;
  } catch (authError: unknown) {
    if (accountOnly && !refuseNonMember && isNotMember(authError)) throw authError;
    // Membership recorded the refusal lazily for exactly this case; record it now.
    if (refuseNonMember && isNotMember(authError)) {
      await TenantSessionService.recordNotMemberDenial(tenantId, user.userId, requiredTenantRole);
    }
    const errorMessage = authError instanceof Error ? authError.message : String(authError);
    // The not-member refusal carries its code on `err.code` only, never in the message.
    const isPermissionError =
      isNotMember(authError) ||
      errorMessage.includes('INSUFFICIENT') ||
      errorMessage.includes('NOT_MEMBER') ||
      errorMessage.includes('permissions');
    if (isPermissionError) {
      // Fire-and-forget — never block auth flow due to logging failure
      AuditLogService.log({
        tenantId,
        actorId: user.userId,
        actorType: 'USER',
        action: AuditActions.PERMISSION_DENIED,
        metadata: {
          requiredRole: requiredTenantRole,
          userId: user.userId,
          reason: errorMessage,
        },
      }).catch(() => {});
    }
    throw authError;
  }

  // The IP lists, after the membership passed (see above): a non-member or under-role caller keeps its denial row.
  if (!ipListsExempt) await assertIp();

  // Step 5: Attach to request
  request.tenant = tenant;
  request.tenantMember = tenantMember;

  // Step 6: Push tenantId / userId into the observability scope so any
  // log / metric / Sentry event from here on auto-inherits them.
  ObservabilityService.setTags({ tenantId, userId: user.userId });

  return { user, userSession, tenant, tenantMember, isGlobalAdmin: false, ipListsExempt };
}


function isNotMember(err: unknown): boolean {
  return err instanceof AppError && err.code === ErrorCode.NOT_TENANT_MEMBER;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * S7: a workspace awaiting deletion (PENDING_DELETION, during the grace period) is read-only. Every write is refused, warm
 * membership cache or not, except the deletion request itself (so its owner can still cancel it). Reads keep working, so the
 * data can be exported before it goes.
 */
function assertWritable(tenant: { tenantStatus?: string } | null | undefined, request: NextRequest): void {
  if (tenant?.tenantStatus !== 'PENDING_DELETION') return;
  if (SAFE_METHODS.has(String(request.method ?? 'GET').toUpperCase())) return;
  const path = (request as { nextUrl?: { pathname?: string } }).nextUrl?.pathname ?? '';
  if (/\/deletion-request(?:\/|$)/.test(path)) return;
  throw new AppError('This workspace is scheduled for deletion and is read-only.', 403, ErrorCode.FORBIDDEN);
}

export async function authenticateTenantByRequest(
  args: Parameters<typeof authenticateTenantByRequestInner>[0],
): Promise<TenantAuthResult> {
  const result = await authenticateTenantByRequestInner(args);
  assertWritable(result?.tenant as { tenantStatus?: string } | null | undefined, args.request);
  return result;
}
