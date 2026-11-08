// path: app/tenant/[tenantId]/api/auth/login/route.ts
import { renderLoginAlertHtml } from '@kuraykaraaslan-labs/auth/server/auth.login-alert';
import { NextRequest, NextResponse } from "next/server";
import AuthService from "@kuraykaraaslan-labs/auth/server/auth.service";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import DeviceRecognitionService from "@kuraykaraaslan-labs/auth/server/auth.device-recognition";
import { resolveLoginMembership, isNoMembershipRefusal, NOT_A_MEMBER_MESSAGE } from "@kuraykaraaslan-labs/auth/server/auth.central-login";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { LoginDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import NotificationService from "@kuraykaraaslan-labs/notification/server/notification.service";
import { SafeUserSecuritySchema } from '@kuraykaraaslan-labs/user_security/server/user_security.types';
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';
import { laneOfRequest } from '@kuraykaraaslan-labs/common/server/lane';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth', 'login');
    const body = await request.json();
    // Public route governed by ABAC (GUEST floor; permit-by-default, admin policy may deny).
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.session.login', scope: 'GUEST' });

    // Verify tenant exists and is active
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({
        error: 'Tenant not found or inactive'
      }, { status: 404 });
    }

    const parsedData = LoginDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        error: parsedData.error.issues
      }, { status: 400 });
    }

    const { email, password, captchaToken, rememberMe } = parsedData.data;

    // Thread tenantId so per-tenant policy (email-verification, lockout,
    // MFA), login-failure metrics (GTH-17) and the account-locked webhook
    // (GTH-18) all resolve against the request tenant.
    const ipAddress = clientIpOf(request.headers);
    const userAgent = request.headers.get('user-agent') ?? undefined;
    // Phase 55 00.8: the lane the proxy stamped decides whether the CAPTCHA may arm (its sign-in lane's captcha column).
    const { user, mustChangePassword, passwordExpiresInDays } = await AuthService.login({ email, password, captchaToken, tenantId, ipAddress, userAgent, lane: laneOfRequest(request).lane });

    if (!user) {
      throw new Error(AuthMessages.INVALID_CREDENTIALS);
    }

    // A member of this tenant, or on the root tenant anybody who belongs to an active tenant: central login, an
    // account-only session (tenantMember null) the client takes to the tenant picker (auth.central-login.ts).
    let tenantMember;
    try {
      ({ tenantMember } = await resolveLoginMembership(tenantId, user.userId));
    } catch (e) {
      // F.auth.04: no membership here at all is answered exactly like a wrong password, so this tenant's sign-in page is no
      // oracle for another tenant's people. A suspended or pending member still learns why.
      if (isNoMembershipRefusal(e)) throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401, ErrorCode.INVALID_CREDENTIALS);
      if (e instanceof AppError && e.code === ErrorCode.NOT_TENANT_MEMBER) {
        return NextResponse.json({ error: NOT_A_MEMBER_MESSAGE }, { status: 403 });
      }
      throw e;
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);

    // Backlog F10 §0: is this somewhere they have signed in from before?
    // Asked BEFORE the session is created, so the row being written now cannot
    // recognise itself — with the check after, every login would look familiar
    // and no alert would ever go out.
    const recognition = await DeviceRecognitionService.recognise(user.userId, { userAgent, ipAddress });

    const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionNextService.createSession({
      user,
      request,
      userSecurity,
      otpIgnore: false,
      rememberMe,
      amr: ['pwd'],
      tenantId,
      accountOnly: tenantMember === null,
      // auth.05: an expired password (or the admin flag on userSecurity) confines the session to the change-password step.
      passwordChangeRequired: mustChangePassword,
    });

    const response = NextResponse.json({
      user,
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.name,
      },
      // null = account-only root session (central login): the caller is not a member here and picks a tenant next.
      tenantMember: tenantMember ? { memberRole: tenantMember.memberRole } : null,
      userSecurity: SafeUserSecuritySchema.parse(userSecurity),
      // Backlog F10 §0: the age-derived half of the password policy. The
      // persisted `userSecurity.mustChangePassword` flag above is the one an
      // admin sets; this one is computed from `passwordChangedAt` against
      // `maxAgeDays` at login and was being thrown away here, so a tenant with
      // an expiry policy blocked people without ever having warned them.
      mustChangePassword: mustChangePassword || userSecurity?.mustChangePassword === true,
      passwordExpiresInDays,
    }, {
      status: 200,
    });

    // Cookie lifetime tracks the session window: 7d normally, 30d for "remember
    // me". The session row's own `sessionExpiry` (+ per-tenant absolute cap) is
    // still the authority — the cookie just avoids being evicted before it.
    // `path` is scoped to this tenant in path-mode tenancy (see
    // sessionCookieOptions) so a session minted for one tenant is never
    // presented on another tenant's `/t/{id}` path.
    const cookieOptions = sessionCookieOptions({ request, tenantId, rememberMe });

    response.cookies.set('accessToken', rawAccessToken, cookieOptions);
    response.cookies.set('refreshToken', rawRefreshToken, cookieOptions);

    // Through the core dispatcher, at NORMAL urgency, so the account settings
    // page's "Email notifications" toggle actually governs this alert (PLAT-01).
    // It is informational — knowing a login happened — not an account-recovery
    // credential, so unlike OTP and password-reset mail it is NOT exempt. A user
    // who turned these off asked for exactly this.
    //
    // Backlog F10 §0: and only when the device or location is NEW. This used to
    // fire on every single sign-in, which is how people learn to delete the
    // alert without reading it — and then delete the one that mattered too.
    // Recognition errs towards alerting: a nuisance mail beats a missed one.
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
      } catch (emailError) {
        // Ignored error for sending login email
      }
    }

    return response;

  } catch (e) {
    return normalizeError(e);
  }
}
