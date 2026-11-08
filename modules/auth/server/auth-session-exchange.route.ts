// path: app/tenant/[tenantId]/api/auth/session/exchange/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { SafeUserSecuritySchema } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import { handoffUrlFor } from "@kuraykaraaslan-labs/auth/server/auth.tenant-switch";
import { derivedSessionClaims } from "@kuraykaraaslan-labs/user_session/server/user_session.fleet-id";

/** The tenant picker's opt-in to a cross-host handoff (see below); any other body is the plain exchange. */
const HandoffBodySchema = z.object({ handoff: z.boolean().optional() }).passthrough();

/**
 * POST /tenant/[tenantId]/api/auth/session/exchange
 *
 * The tenant-switcher's silent hop: the caller already holds a valid session
 * for SOME tenant (any tenant — that is the whole point of `scope: 'ACCOUNT'`
 * below, which authenticates the user without checking membership in the URL
 * tenant). Proven identity + a live ACTIVE membership in `tenantId` is enough
 * to mint a brand-new, independent session scoped to `tenantId` — no
 * password/OTP re-entry, because the caller already cleared that bar for
 * their existing session.
 *
 * This does NOT touch the source session — a user switching tenant in one
 * tab keeps working in the other. Every session is still tenant-scoped after
 * this call: it does not widen anything, it just mints one more.
 *
 * Body `{ handoff: true }` (the tenant picker): when the target tenant has its own host (domain tenancy) and it is
 * not this one, a cookie set here would never reach it (cookies are host-only). The answer is then
 * `{ handoffUrl }` on the target host instead of cookies: a one-time code (user_session.handoff.service) that the
 * target's /api/auth/session/handoff redeems, creating the session there. Otherwise (path tenancy, no own host, or
 * already on it) the exchange sets the cookies here as before and answers `handoffUrl: null`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth');

    // Cookie sessions only. A device-bearer caller has no cookie jar to
    // receive the Set-Cookie response below, and — the actual point — the
    // owner's decision was that a device holds ONE tenant's credentials at a
    // time and re-authenticates per tenant (auth-device-login.route.ts), not
    // silently hop via this endpoint the way the web switcher does.
    if (!request.cookies.get('accessToken')?.value) {
      throw new AppError('Session exchange requires a cookie-based session.', 401, ErrorCode.UNAUTHORIZED);
    }

    const { user, userSession } = await authorizeRequest({
      request,
      requiredPermission: 'auth.session.exchange',
      scope: 'ACCOUNT',
    });

    // auth_impersonation.01: an impersonation session is bound to the tenant it was granted for. ACCOUNT scope does not check the
    // URL tenant, so without this an impersonator would hop into every other tenant the impersonated user belongs to (by cookie
    // or by handoff). The minted session would also be an ORDINARY one (no impersonation marker, no impersonation expiry), so
    // even the same tenant is refused: an impersonation session is never exchanged. Refused before anything is looked up or minted.
    const sessionMeta = (userSession as { metadata?: { impersonation?: unknown } | null } | undefined)?.metadata;
    if (sessionMeta?.impersonation) {
      throw new AppError('An impersonation session cannot be exchanged.', 403, ErrorCode.FORBIDDEN);
    }

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      throw new AppError('Tenant not found or inactive', 404, ErrorCode.NOT_FOUND);
    }

    const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: user.userId });
    if (!tenantMember || tenantMember.memberStatus !== 'ACTIVE') {
      throw new AppError('You are not a member of this organization', 403, ErrorCode.NOT_TENANT_MEMBER);
    }

    // A session exchanged from a Fleet ID session stays one (FID-07): same `sid`, and never longer than the login it came from, so the hub's
    // back-channel logout ends it with the original and the 8-hour cap cannot be restarted by switching tenant. Every exchanged session keeps
    // the source's `amr` (FID-08): switching tenant is no new login, so a passkey session must not arrive as `acr NONE`. The same claims
    // travel in a cross-host handoff, so the session its redeeming route creates on the target host inherits them too.
    const claims = derivedSessionClaims(userSession);

    const body = HandoffBodySchema.safeParse(await request.json().catch(() => ({})));
    if (body.success && body.data.handoff) {
      const handoffUrl = await handoffUrlFor(request, user.userId, tenantId, '/admin', claims);
      if (handoffUrl) {
        AuditLogService.log({
          tenantId,
          actorId: user.userId,
          actorType: 'USER',
          action: 'user_session.handoff',
          resourceType: 'user_session',
          resourceId: user.userId,
          metadata: { userId: user.userId, targetHost: new URL(handoffUrl).host },
        }).catch(() => {});
        return NextResponse.json({
          tenant: { tenantId: tenant.tenantId, name: tenant.name },
          handoffUrl,
        }, { status: 200 });
      }
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);

    // otpIgnore: the caller already passed OTP (if required) on the session
    // they are exchanging FROM — this mints a new tenant, not a new identity.
    const { rawAccessToken, rawRefreshToken } = await UserSessionNextService.createSession({
      user,
      request,
      userSecurity,
      otpIgnore: true,
      tenantId,
      ...claims,
    });

    AuditLogService.log({
      tenantId,
      actorId: user.userId,
      actorType: 'USER',
      action: 'user_session.exchange',
      resourceType: 'user_session',
      resourceId: user.userId,
      metadata: { userId: user.userId },
    }).catch(() => {});

    const response = NextResponse.json({
      user,
      tenant: { tenantId: tenant.tenantId, name: tenant.name },
      tenantMember: { memberRole: tenantMember.memberRole },
      userSecurity: SafeUserSecuritySchema.parse(userSecurity),
      handoffUrl: null,
    }, { status: 200 });

    const cookieOptions = sessionCookieOptions({ request, tenantId });
    response.cookies.set('accessToken', rawAccessToken, cookieOptions);
    response.cookies.set('refreshToken', rawRefreshToken, cookieOptions);

    return response;
  } catch (e) {
    return normalizeError(e);
  }
}
