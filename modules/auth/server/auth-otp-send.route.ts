// path: app/tenant/[tenantId]/api/auth/otp/send/route.ts
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import OTPService from "@kuraykaraaslan-labs/auth/server/auth.otp.service";
import { resolveLoginMembership, NOT_A_MEMBER_MESSAGE } from "@kuraykaraaslan-labs/auth/server/auth.central-login";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { RequestOTPDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { resolveLocale } from "@kuraykaraaslan-labs/auth/server/auth.i18n";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { noteOtpSent } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth', 'otp-send');

    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'auth.me.otp.send', scope: 'ACCOUNT' });
    // auth.14: the tenant is looked up AFTER the guard, so an anonymous caller cannot tell an active tenant from a suspended or missing one.
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    // The same rule as signing in: a member, or an account-only root session (central login) finishing its own code.
    try {
      await resolveLoginMembership(tenantId, user.userId);
    } catch (e) {
      if (e instanceof AppError && e.code === ErrorCode.NOT_TENANT_MEMBER) {
        return NextResponse.json({ error: NOT_A_MEMBER_MESSAGE }, { status: 403 });
      }
      throw e;
    }

    const body = await request.json();

    const parsedData = RequestOTPDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        message: parsedData.error.issues.map((err: any) => err.message).join(", ")
      }, { status: 400 });
    }

    const { method, action } = parsedData.data;

    // auth.13: a session that still owes its second factor reaches this route only to finish that step.
    if (userSession.otpVerifyNeeded && action !== 'authenticate') {
      return NextResponse.json({ message: AuthMessages.OTP_REQUIRED }, { status: 403 });
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);
    const userOTPMethods = userSecurity.otpMethods;

    if (action === "enable" && userOTPMethods.includes(method)) {
      return NextResponse.json(
        { message: AuthMessages.OTP_METHOD_ALREADY_ENABLED },
        { status: 400 }
      );
    }

    // auth.04: the sign-in step only accepts a method the account enrolled (it used to accept any EMAIL / SMS code, so MFA
    // fell to the weakest channel).
    // 38-security 3.3: a session stepped up for a risky sign-in by a person with no enrolled factor may receive an e-mail code for the sign-in step only.
    const stepUpEmail = action === "authenticate" && method === "EMAIL" && (userSession.metadata as { stepUpEmail?: boolean } | null | undefined)?.stepUpEmail === true;
    if ((action === "disable" || action === "authenticate") && !userOTPMethods.includes(method) && !stepUpEmail) {
      return NextResponse.json(
        { message: AuthMessages.OTP_METHOD_NOT_ENABLED },
        { status: 400 }
      );
    }

    const locale = resolveLocale(request.headers.get('accept-language'));
    await OTPService.requestOTP({ user, userSession, method, action, tenantId, locale });
    // Phase 55 02.6: a code sent is a signal for the AI firewall (tallied; synchronous, never changes this answer).
    noteOtpSent(request, { tenantId, userId: user.userId, method, action });

    return NextResponse.json({ message: AuthMessages.OTP_SENT_SUCCESSFULLY });

  } catch (e) {
    return normalizeError(e);
  }
}
