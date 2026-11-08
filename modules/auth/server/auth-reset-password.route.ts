// path: app/tenant/[tenantId]/api/auth/reset-password/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import PasswordService from "@kuraykaraaslan-labs/auth/server/auth.password.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { ResetPasswordDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import IpStrikeService from "@kuraykaraaslan-labs/limiter/server/limiter.ip-strikes";
import { clientIpOf } from "@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip";
import { sessionCookiePath } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";

/**
 * Password reset is an onboarding/recovery endpoint — the caller is not
 * yet authenticated, so per-tenant membership cannot be enforced. We only
 * validate that the addressed tenant exists and is active.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');
    // Public route governed by ABAC (GUEST floor; permit-by-default, admin policy may deny).
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.account.reset_password', scope: 'GUEST' });

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const { email, resetToken, password } = await request.json();

    const parsedData = ResetPasswordDTO.safeParse({ email, resetToken, newPassword: password });

    if (!parsedData.success) {
      return NextResponse.json({
        error: parsedData.error.issues.map(err => err.message).join(", ")
      }, { status: 400 });
    }

    try {
      await PasswordService.resetPassword({ ...parsedData.data, tenantId });
    } catch (err) {
      // 38-security 2.1: a wrong or unknown reset token is a guess; it counts against the address across accounts.
      if (err instanceof AppError && err.message === AuthMessages.INVALID_TOKEN) {
        await IpStrikeService.recordStrike(clientIpOf(request.headers), 'reset_token_failed');
      }
      throw err;
    }

    const response = NextResponse.json({
      message: AuthMessages.PASSWORD_RESET_SUCCESSFUL,
    }, {
      status: 200,
    });

    // Determine if we're in a secure context (HTTPS)
    const origin = request.headers.get('origin') || '';
    const protocol = request.headers.get('x-forwarded-proto') || request.headers.get('x-scheme') || 'http';
    const isSecure = origin.startsWith('https://') || protocol === 'https';
    const path = sessionCookiePath(tenantId);

    response.cookies.set('accessToken', '', {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax' as const,
      path,
      maxAge: 0,
    });

    response.cookies.set('refreshToken', '', {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax' as const,
      path,
      maxAge: 0,
    });

    return response;

  } catch (e) {
    // An unknown account is answered exactly like a wrong token (no oracle for registered addresses).
    if ((e as { message?: unknown } | null)?.message === AuthMessages.USER_NOT_FOUND) {
      return normalizeError(new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR));
    }
    return normalizeError(e);
  }
}
