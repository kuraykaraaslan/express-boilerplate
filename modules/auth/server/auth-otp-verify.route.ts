// path: app/tenant/[tenantId]/api/auth/otp/verify/route.ts
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import OTPService from "@kuraykaraaslan-labs/auth/server/auth.otp.service";
import { resolveLoginMembership, NOT_A_MEMBER_MESSAGE } from "@kuraykaraaslan-labs/auth/server/auth.central-login";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { VerifyOTPDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import { OTPActionEnum } from "@kuraykaraaslan-labs/user_security/server/user_security.enums";
import { ROOT_TENANT_ID } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { TRUSTED_DEVICE_COOKIE, TRUSTED_DEVICE_DAYS, trustedDeviceCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { secondFactorAttemptOf } from "@kuraykaraaslan-labs/auth/server/auth.second-factor.next";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');

    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'auth.me.otp.verify', scope: 'ACCOUNT' });
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

    const parsedData = VerifyOTPDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { message: parsedData.error.issues.map(err => err.message).join(", ") },
        { status: 400 }
      );
    }

    const { method, action, otpToken, trustDevice } = parsedData.data;

    // auth.13: a session that still owes its second factor reaches this route only to finish that step.
    if (userSession.otpVerifyNeeded && action !== OTPActionEnum.enum.authenticate) {
      return NextResponse.json({ message: AuthMessages.OTP_REQUIRED }, { status: 403 });
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);

    const userOTPMethods = userSecurity.otpMethods;

    // auth.04: the sign-in step is completed only with a method the account enrolled.
    const stepUpEmail = action === OTPActionEnum.enum.authenticate && method === 'EMAIL'
      && (userSession.metadata as { stepUpEmail?: boolean } | null | undefined)?.stepUpEmail === true;
    if (action === OTPActionEnum.enum.authenticate && !userOTPMethods.includes(method) && !stepUpEmail) {
      return NextResponse.json({ message: AuthMessages.OTP_METHOD_NOT_ENABLED }, { status: 400 });
    }

    // Phase 55 00.5: a wrong code strikes this address on a human lane and is audited (auth.second-factor-guard.ts). Only the sign-in step
    // (a session still waiting for its second factor, reached with the password) counts on the account; any other code is typed inside a
    // live session, which a stolen cookie is enough for, so it counts on that session and never blocks the owner's sign-in.
    const flow = action === OTPActionEnum.enum.authenticate
      ? (userSession.otpVerifyNeeded ? 'sign_in' : 'other')
      : action === OTPActionEnum.enum.enable ? 'otp_enable' : 'otp_disable';
    const attempt = secondFactorAttemptOf(request, { tenantId, flow, userSessionId: userSession.userSessionId });
    await OTPService.verifyOTP({ user, userSession, method, action, otpToken, tenantId, attempt });
    // Update user security settings based on action

    if (action === OTPActionEnum.enum.enable && !userOTPMethods.includes(method)) {
      const updatedMethods = [...userOTPMethods, method];
      await UserSecurityService.updateUserSecurity(user.userId, { otpMethods: updatedMethods });
      // The `otp_enabled` / `otp_disabled` templates had no caller until here:
      // a second factor appearing or disappearing on an account is a security
      // fact its owner must hear, whatever else they have muted.
      //
      // Under the ROOT tenant, like the password-change notice: `otpMethods`
      // lives on UserSecurity, so it is an ACCOUNT fact. A user in three
      // workspaces is told once, by the platform, not three times.
      void OTPService.notifyOtpMethodChanged(ROOT_TENANT_ID, { userId: user.userId, email: user.email }, true);
      // Phase 55 00.4: the audit row and the tenant webhook (`security.mfa_enabled`), which had no caller until here. Best-effort.
      void Promise.resolve().then(() => UserSecurityService.emitMfaChanged(tenantId, user.userId, true, { method })).catch(() => {});
    }

    if (action === OTPActionEnum.enum.disable && userOTPMethods.includes(method)) {
      const updatedMethods = userOTPMethods.filter(m => m !== method);
      await UserSecurityService.updateUserSecurity(user.userId, { otpMethods: updatedMethods });
      void OTPService.notifyOtpMethodChanged(ROOT_TENANT_ID, { userId: user.userId, email: user.email }, false);
      // Phase 55 00.4: `security.mfa_disabled` (high), the "MFA disabled" signal. Best-effort.
      void Promise.resolve().then(() => UserSecurityService.emitMfaChanged(tenantId, user.userId, false, { method })).catch(() => {});
    }

    const response = NextResponse.json({ message: AuthMessages.OTP_VERIFIED_SUCCESSFULLY }, { status: 200 });

    // 38-security 3.4: the person asked to trust this browser after a successful SIGN-IN code. Only the authenticate action may mint one
    // (enabling or disabling a method is not a sign-in), only a verified code reaches here, and only the token's hash is stored.
    if (trustDevice === true && action === OTPActionEnum.enum.authenticate) {
      try {
        const label = (request.headers.get('user-agent') ?? '').slice(0, 120) || null;
        const token = await UserSecurityService.trustDevice(user.userId, label, TRUSTED_DEVICE_DAYS);
        response.cookies.set(TRUSTED_DEVICE_COOKIE, token, trustedDeviceCookieOptions(request));
      } catch (err) {
        // Never undoes a verified sign-in: the person is simply asked again next time.
        void err;
      }
    }

    return response;

  } catch (e) {
    return normalizeError(e);
  }
}
