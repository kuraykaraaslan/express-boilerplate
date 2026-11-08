// path: app/tenant/[tenantId]/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import AuthService from "@kuraykaraaslan-labs/auth/server/auth.service";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { registrationOpen } from '@kuraykaraaslan-labs/auth/server/auth.registration';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { resolveLocale } from "@kuraykaraaslan-labs/auth/server/auth.i18n";
import Logger from "@kuraykaraaslan-labs/logger";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { RegisterDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import CaptchaService from "@kuraykaraaslan-labs/auth/server/auth.captcha.service";
import { clientIpOf } from "@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip";
import { laneOfRequest, signInLanePolicy } from '@kuraykaraaslan-labs/common/server/lane';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { signupBlocked, signupMarksOf } from "@kuraykaraaslan-labs/auth/server/auth.signup-protection";
import { noteSignupBlocked } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth', 'register');
    const body = await request.json();
    // Public route governed by ABAC (GUEST floor; permit-by-default, admin policy may deny).
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.account.register', scope: 'GUEST' });

    // Verify tenant exists and is active
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({
        error: 'Tenant not found or inactive'
      }, { status: 404 });
    }

    // The tenant's self-registration switch and its access policy (auth.registration.ts).
    if (!(await registrationOpen(tenantId))) {
      return NextResponse.json({
        error: 'Self-registration is not allowed for this organization'
      }, { status: 403 });
    }

    const parsedData = RegisterDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        error: parsedData.error.issues
      }, { status: 400 });
    }

    const { email, password, phone, consentVersion, captchaToken } = parsedData.data;

    // Phase 55 02.6: the AI firewall's marks on the address (auth.signup-protection.ts; one bounded read, none when Redis does not answer,
    // and no read at all while no mark can hold anywhere, D55-73). A hard block holds only where the tenant opted in to one; the CAPTCHA
    // mark asks for the challenge from the first sign-up.
    const address = clientIpOf(request.headers);
    const marks = await signupMarksOf(tenantId, address);
    if (await signupBlocked(tenantId, marks)) {
      noteSignupBlocked(request, tenantId);
      throw new AppError(AuthMessages.SIGNUP_BLOCKED, 403, ErrorCode.FORBIDDEN);
    }

    // 38-security 2.4: bot sign-ups from one address hit a CAPTCHA once a provider is configured.
    // Phase 55 00.8: only where the request's sign-in lane takes a CAPTCHA (lane table, captcha column; 38 L-4, L-2).
    if (signInLanePolicy(laneOfRequest(request).lane).captcha) await CaptchaService.guardRegister(address, captchaToken, { marked: marks.captcha });

    // Register the user. Pass tenantId so the per-tenant password policy,
    // allowRegistration posture (GTH-1), per-tenant bcrypt cost (GTH-6) and the
    // consent record (GTH-7) are all applied in the service layer.
    const { user } = await AuthService.register({ email, password, phone, tenantId, consentVersion });

    if (!user) {
      return NextResponse.json({
        error: 'Failed to create user'
      }, { status: 500 });
    }

    // On the root tenant this is the platform sign-up: the account alone, no root membership. The person signs in
    // (central login, an account-only session) and opens their own organization in the onboarding. On any other tenant
    // they join it as a USER.
    // The verification mail goes out now (the account is otherwise unverified until someone asks for it again). Best
    // effort: a mail that cannot be sent never undoes the sign-up; the verify page can send it again.
    try {
      await AuthService.sendEmailVerification({
        userId: user.userId, email: user.email, tenantId, locale: resolveLocale(request.headers.get('accept-language')),
      });
    } catch (err) {
      Logger.warn(`[register] verification mail not sent for ${user.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const onboarding = isRootTenant(tenantId);
    if (!onboarding) {
      await TenantMemberService.create({
        tenantId,
        userId: user.userId,
        // Always USER, whatever `defaultMemberRole` says (05-tenant-member 3.1, owner decision 2026-10-25): anyone on the
        // internet can self-register, so a default of ADMIN would hand out tenant admin rights to strangers. That setting
        // applies to invitations and admin-created members only.
        memberRole: 'USER',
        memberStatus: 'ACTIVE',
      });
    }

    return NextResponse.json({
      message: 'Registration successful',
      user: {
        userId: user.userId,
        email: user.email,
      },
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.name,
      },
      // The client signs the new account in and continues to /auth/onboarding (platform sign-up only).
      onboarding,
    }, { status: 201 });

  } catch (e) {
    return normalizeError(e);
  }
}
