// path: app/tenant/[tenantId]/api/auth/device/login/route.ts
import { renderLoginAlertHtml } from '@kuraykaraaslan-labs/auth/server/auth.login-alert';
import { NextRequest, NextResponse } from "next/server";
import AuthService from "@kuraykaraaslan-labs/auth/server/auth.service";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import DeviceRecognitionService from "@kuraykaraaslan-labs/auth/server/auth.device-recognition";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { DeviceLoginDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import NotificationService from "@kuraykaraaslan-labs/notification/server/notification.service";
import { SafeUserSecuritySchema } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { collectSessionExtensions } from "@kuraykaraaslan-labs/auth/server/auth.session-extension";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { laneOfRequest } from '@kuraykaraaslan-labs/common/server/lane';

/**
 * Device-bearer counterpart of auth-login.route.ts — for any client with no
 * shared browser cookie jar (phone, tablet, watch, TV, …), not phones alone.
 * Same credential/tenant/membership checks, but the token pair comes back in
 * the JSON body (audience `device`) instead of an httpOnly cookie, and an
 * optional `device` object (brand/model/type — see DeviceLoginDTO) is stored
 * on the session for the account's "Active sessions" list. Every other tenant
 * a user belongs to needs its own call here: the resulting token is scoped to
 * THIS tenantId only (see TokenPayload.tenantId) and is rejected by any other
 * tenant's requests — there is deliberately no "switch tenant" shortcut on
 * this endpoint, unlike the web session-exchange route, since a device
 * install is expected to hold one tenant's credentials at a time.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth');
    const body = await request.json();
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.login', scope: 'GUEST' });

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const parsedData = DeviceLoginDTO.safeParse(body);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues }, { status: 400 });
    }

    const { email, password, captchaToken, rememberMe, device } = parsedData.data;

    const ipAddress = clientIpOf(request.headers);
    const userAgent = request.headers.get('user-agent') ?? undefined;
    // Phase 55 00.8: the lane the proxy stamped decides whether the CAPTCHA may arm (its sign-in lane's captcha column).
    const { user, mustChangePassword, passwordExpiresInDays } = await AuthService.login({ email, password, captchaToken, tenantId, ipAddress, userAgent, lane: laneOfRequest(request).lane });

    if (!user) {
      throw new Error(AuthMessages.INVALID_CREDENTIALS);
    }

    const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: user.userId });
    // F.auth.04: no membership at all is answered exactly like a wrong password (no password oracle for another tenant's people).
    if (!tenantMember) throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401, ErrorCode.INVALID_CREDENTIALS);
    if (tenantMember.memberStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'You are not a member of this organization' }, { status: 403 });
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);
    const recognition = await DeviceRecognitionService.recognise(user.userId, { userAgent, ipAddress });

    const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionNextService.createSession({
      user,
      request,
      userSecurity,
      otpIgnore: false,
      rememberMe,
      tenantId,
      audience: 'device',
      device,
      // A password proved this login (FID-08); a verified OTP later adds `otp` and `mfa`.
      amr: ['pwd'],
      // auth.05: an expired password (or the admin flag on userSecurity) confines the session to the change-password step.
      passwordChangeRequired: mustChangePassword,
    });

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
        // Ignored — a notification failure must never fail the login.
      }
    }

    // Sections satellites add (e.g. `compliance.pendingAgreements`), so the app can
    // react on first paint without a second call.
    const extensions = await collectSessionExtensions(tenantId, user.userId);

    return NextResponse.json({
      ...extensions,
      accessToken: rawAccessToken,
      refreshToken: rawRefreshToken,
      otpRequired: userSession.otpVerifyNeeded,
      user,
      tenant: { tenantId: tenant.tenantId, name: tenant.name },
      tenantMember: { memberRole: tenantMember.memberRole },
      userSecurity: SafeUserSecuritySchema.parse(userSecurity),
      mustChangePassword: mustChangePassword || userSecurity?.mustChangePassword === true,
      passwordExpiresInDays,
    }, { status: 200 });

  } catch (e) {
    return normalizeError(e);
  }
}
