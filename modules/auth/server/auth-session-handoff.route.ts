// path: app/tenant/[tenantId]/api/auth/session/handoff/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import UserSessionNextHelpers from "@kuraykaraaslan-labs/user_session/server/user_session.next.helpers";
import { consumeSessionHandoff } from "@kuraykaraaslan-labs/user_session/server/user_session.handoff.service";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import UserService from "@kuraykaraaslan-labs/user/server/user.service";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { tenantPath } from "@kuraykaraaslan-labs/common/server/tenant-path";
import Logger from "@kuraykaraaslan-labs/logger";

/** Where a handoff may land: the admin area of this tenant, nothing else (a stored path is still checked). */
const LANDING = /^\/admin(?:\/[A-Za-z0-9._~\-/]*)?$/;

/**
 * GET /tenant/[tenantId]/api/auth/session/handoff?code=…
 *
 * The second half of a cross-host tenant switch (auth-session-exchange.route.ts, `handoff: true`): the picker on one
 * host sent the browser here, to the picked tenant's own host, with a one-time code. Redeeming it creates the session
 * HERE, from this request, so its cookie is set on this host and its fingerprint is this browser's.
 *
 * Every check the exchange made is made again, since time passed and the code only names an identity: the code is
 * for this tenant, comes from this browser (same fingerprint as the request that asked for it), the user is ACTIVE,
 * still an ACTIVE member, and the tenant is ACTIVE. Any failure lands on this tenant's sign-in page with no session;
 * the code is spent either way (single-use). The landing path is the stored one when it is inside /admin.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  // A relative Location (RFC 9110): behind the edge proxy request.url is the internal origin (localhost:3000), so an
  // absolute URL built from it would send the browser there; the browser resolves this one against the host it is on.
  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: tenantPath(tenantId, path) } });
  // The visitor learns nothing about why (every refusal is the same redirect); the log says which check failed, never the code.
  const refuse = (reason: string) => {
    Logger.warn(`[auth] session handoff refused for tenant ${tenantId}: ${reason}`);
    return go('/auth/login');
  };
  try {
    await Limiter.checkRateLimit(request, 'auth');
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.handoff', scope: 'GUEST' });

    const handoff = await consumeSessionHandoff(request.nextUrl.searchParams.get('code'));
    if (!handoff) return refuse('unknown, expired or spent code');
    if (handoff.tenantId !== tenantId) return refuse('code minted for another tenant');
    if (handoff.fingerprint !== UserSessionNextHelpers.generateDeviceFingerprint(request)) return refuse('another browser');

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') return refuse('tenant not active');
    const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: handoff.userId });
    if (!tenantMember || tenantMember.memberStatus !== 'ACTIVE') return refuse('not an active member');
    const user = await UserService.getById(handoff.userId);
    if (!user || user.userStatus !== 'ACTIVE') return refuse('user not active');

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);
    // otpIgnore: the code was minted by a session that had passed its one-time code (the exchange's ACCOUNT scope
    // refuses a pending one), so this is the same sign-in arriving on another host, not a new one.
    const { rawAccessToken, rawRefreshToken } = await UserSessionNextService.createSession({
      user,
      request,
      userSecurity,
      otpIgnore: true,
      tenantId,
      // The source session's FleET ID marker and amr, carried by the code (auth-session-exchange.route.ts): the session created here never
      // outlives a Fleet ID login it was switched from (createSession refuses a passed deadline) and keeps how the person authenticated.
      ...(handoff.fleetId ? { fleetId: handoff.fleetId } : {}),
      ...(handoff.amr?.length ? { amr: handoff.amr } : {}),
    });

    AuditLogService.log({
      tenantId,
      actorId: user.userId,
      actorType: 'USER',
      action: 'user_session.exchange',
      resourceType: 'user_session',
      resourceId: user.userId,
      metadata: { userId: user.userId, via: 'handoff' },
    }).catch(() => {});

    const response = go(LANDING.test(handoff.next) && !handoff.next.includes('//') ? handoff.next : '/admin');
    const cookieOptions = sessionCookieOptions({ request, tenantId });
    response.cookies.set('accessToken', rawAccessToken, cookieOptions);
    response.cookies.set('refreshToken', rawRefreshToken, cookieOptions);
    // The code is in this URL; do not hand it to the next page as a Referer.
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (e) {
    return refuse(`error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
