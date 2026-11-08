// path: app/tenant/[tenantId]/api/auth/onboarding/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { onboardingStatus, createOwnTenant, OnboardingCreateDTO } from "@kuraykaraaslan-labs/auth/server/auth.onboarding.service";
import { detectCountryFromRequest } from "@kuraykaraaslan-labs/tenant/server/tenant.country.detect";
import { handoffUrlFor } from "@kuraykaraaslan-labs/auth/server/auth.tenant-switch";
import { derivedSessionClaims } from "@kuraykaraaslan-labs/user_session/server/user_session.fleet-id";
import { isRootTenant } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * /tenant/[tenantId]/api/auth/onboarding — the platform sign-up's second step (auth.onboarding.service.ts), on the root
 * tenant only (anywhere else a 404). ACCOUNT scope: any signed-in person, the account-only session of the central
 * login included; no root membership is needed or created.
 *
 *  GET   whether this person may open an organization now (`canCreate`, `reason`, `owned`, `limit`).
 *  POST  `{ name, slug }`: open it with the person as OWNER, then enter it: a handoff URL to its own host (domain
 *        tenancy), or a session for it set here (`handoffUrl: null`; the client goes to `/tenant/{id}/admin`).
 *        `fleetIdLogin: true` when the session that opened it is a Fleet ID session (FID-09): the client should rather enter the
 *        new organization through a Fleet ID login of its own (the node's `enterUrl` with `fid_enter`), because only a login
 *        there reports the workspace to the hub's "my workspaces" list (the link needs that login's access token).
 *        `enter: 'fleet-id'` in the body says the client already holds a usable `enterUrl` and will take that login: then
 *        no handoff and no session are minted here (that login mints its own, so a fallback would be a live session no
 *        browser holds, or a handoff code nobody redeems). Without it the handoff or the session set here is the way in.
 */

/** Whether the session carries user_session's Fleet ID marker at all (readable or not). */
function isFleetIdSession(userSession: { metadata?: unknown } | null | undefined): boolean {
  const meta = userSession?.metadata;
  return !!meta && typeof meta === 'object' && !!(meta as { fleetId?: unknown }).fleetId;
}

const rootOnly = async (params: Promise<{ tenantId: string }>) => {
  const { tenantId } = await params;
  if (!isRootTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
  return tenantId;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    await rootOnly(params);
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'auth.onboarding.read', scope: 'ACCOUNT' });
    return NextResponse.json(await onboardingStatus(user.userId), { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    await rootOnly(params);
    await Limiter.checkRateLimit(request, 'auth');
    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'auth.onboarding.create', scope: 'ACCOUNT' });
    const parsed = OnboardingCreateDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', '), code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const { enter, ...input } = parsed.data;
    // 49.1: the new organization's country is read from this request (geo-IP, else the language's region, else TR), silently
    const tenant = await createOwnTenant(user.userId, input, await detectCountryFromRequest(request));
    AuditLogService.log({
      tenantId: tenant.tenantId,
      actorId: user.userId,
      actorType: 'USER',
      action: 'tenant.self_service_created',
      resourceType: 'tenant',
      resourceId: tenant.tenantId,
      metadata: { slug: tenant.slug },
    }).catch(() => {});

    // Whether this is a Fleet ID session is user_session's own marker (metadata.fleetId); auth imports no fleet module.
    const fleetIdLogin = isFleetIdSession(userSession);
    const body = {
      tenant: { tenantId: tenant.tenantId, name: tenant.name, slug: tenant.slug },
      ...(fleetIdLogin ? { fleetIdLogin: true } : {}),
    };
    const noWayIn = () => NextResponse.json({ ...body, handoffUrl: null }, { status: 201 });
    // The organization exists from here on: a failure to ENTER it is still a 201 (without a way in, the client goes
    // through the sign-in of the new tenant or the picker), never an error that invites a retry the limit refuses.
    // The client takes the Fleet ID login into it: that login mints the session, so nothing is minted here.
    if (fleetIdLogin && enter === 'fleet-id') return noWayIn();
    try {
      // Entering the new organization derives a session from this one: a Fleet ID session's marker and deadline and the amr carry over
      // (user_session.fleet-id.ts), here or through the handoff, exactly as a tenant switch does. A marker that cannot be read into a
      // deadline (a malformed maxHours) throws here and ends in the 201 without a way in, never in a derived session that lost the marker.
      const claims = derivedSessionClaims(userSession);
      const handoffUrl = await handoffUrlFor(request, user.userId, tenant.tenantId, '/admin', claims);
      if (handoffUrl) return NextResponse.json({ ...body, handoffUrl }, { status: 201 });

      // No host of its own (path tenancy, or no serving subdomain yet): a session for it, set here.
      const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);
      const { rawAccessToken, rawRefreshToken } = await UserSessionNextService.createSession({
        user, request, userSecurity, otpIgnore: true, tenantId: tenant.tenantId, ...claims,
      });
      const response = NextResponse.json({ ...body, handoffUrl: null }, { status: 201 });
      const cookieOptions = sessionCookieOptions({ request, tenantId: tenant.tenantId });
      response.cookies.set('accessToken', rawAccessToken, cookieOptions);
      response.cookies.set('refreshToken', rawRefreshToken, cookieOptions);
      return response;
    } catch {
      return noWayIn();
    }
  } catch (e) {
    return normalizeError(e);
  }
}
