import { renderLoginAlertHtml } from '@kuraykaraaslan-labs/auth/server/auth.login-alert';
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuthMagicLinkService from "@kuraykaraaslan-labs/auth/server/auth.magic-link.service";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import DeviceRecognitionService from "@kuraykaraaslan-labs/auth/server/auth.device-recognition";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import NotificationService from "@kuraykaraaslan-labs/notification/server/notification.service";
import { SafeUserSecuritySchema } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import { MagicLinkConsumeDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * POST …/api/auth/magic-link/consume — trade a link token for a session.
 *
 * The token is single-use and short-lived (the service deletes it before doing
 * anything else). The session is created through the SAME path the password
 * login uses, so a tenant that requires MFA still gets the OTP step — a magic
 * link is a first factor, not a bypass.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.login', scope: 'GUEST' });

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const parsed = MagicLinkConsumeDTO.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const user = await AuthMagicLinkService.consume({ token: parsed.data.token, tenantId });

    const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: user.userId });
    if (!tenantMember || tenantMember.memberStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'You are not a member of this organization' }, { status: 403 });
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);

    const ipAddress = clientIpOf(request.headers);
    const userAgent = request.headers.get('user-agent') ?? undefined;
    // Asked before the session row is written — same ordering as the password
    // login, or every sign-in would recognise itself.
    const recognition = await DeviceRecognitionService.recognise(user.userId, { userAgent, ipAddress });

    // No `amr` (FID-08): RFC 8176 names no e-mail link method, so the session is `acr NONE` until a verified OTP adds `otp` and `mfa`.
    const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionNextService.createSession({
      user,
      request,
      userSecurity,
      otpIgnore: false,
      tenantId,
    });

    const response = NextResponse.json({
      user,
      tenant: { tenantId: tenant.tenantId, name: tenant.name },
      tenantMember: { memberRole: tenantMember.memberRole },
      userSecurity: SafeUserSecuritySchema.parse(userSecurity),
    }, { status: 200 });

    const cookieOptions = sessionCookieOptions({ request, tenantId });

    response.cookies.set('accessToken', rawAccessToken, cookieOptions);
    response.cookies.set('refreshToken', rawRefreshToken, cookieOptions);

    // Same new-device alert the password login sends (backlog F10 §0) — a
    // passwordless sign-in from somewhere new is exactly as worth telling
    // someone about.
    if (!recognition.known) {
      try {
        await NotificationService.notify(
          tenantId,
          { userId: user.userId, email: user.email },
          {
            event: 'auth.new_login',
            category: 'security_alert',
            title: 'New sign-in to your account',
            body: 'A new sign-in to your account was detected.',
            data: { html: await renderLoginAlertHtml({ tenantId, user: { email: user.email, name: (user as { name?: string | null }).name }, userAgent, ipAddress, geo: userSession.metadata?.geo }) },
          },
          { channels: ['mail'] },
        );
      } catch {
        // best-effort
      }
    }

    return response;
  } catch (e) {
    return normalizeError(e);
  }
}
