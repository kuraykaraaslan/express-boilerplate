// path: app/tenant/[tenantId]/api/auth/verify-email/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuthService from "@kuraykaraaslan-labs/auth/server/auth.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { VerifyEmailDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError } from "@kuraykaraaslan-labs/common/server/app-error";

/**
 * Email verification is an onboarding endpoint — tenant membership is NOT
 * required at this stage; we only validate that the addressed tenant exists.
 *
 *  - Signed in: the link's token against the caller's own account (as before).
 *  - Not signed in (a fresh sign-up, or a tenant that will not sign an unverified
 *    account in): `{ token, email, password }`, the token proving the inbox and the
 *    password the account (auth.verification.service verifyEmailWithPassword).
 *    Public (GUEST), on the `auth` rate limit; every failure is the same answer.
 */
const VerifyWithPasswordDTO = z.strictObject({
  token: z.string().min(1).max(256),
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(256),
});
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    // The password path: no session at all, or a session that does not authenticate (an expired or revoked cookie
    // left in the browser must not trap the person in a path that can never succeed). A body's email and password
    // are never read against a session that DOES authenticate.
    const passwordPath = async () => {
      await authorizeRequest({ request, tenantId, requiredPermission: 'auth.account.verify_email', scope: 'GUEST' });
      const parsed = VerifyWithPasswordDTO.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: AuthMessages.USER_NOT_AUTHENTICATED, code: 'PASSWORD_REQUIRED' }, { status: 401 });
      }
      await AuthService.verifyEmailWithPassword(parsed.data);
      return NextResponse.json({ message: AuthMessages.EMAIL_VERIFIED_SUCCESSFULLY }, { status: 200 });
    };
    if (!request.cookies.get('accessToken')?.value && !request.headers.get('authorization')) return await passwordPath();

    try {
      await authorizeRequest({ request, requiredPermission: 'auth.me.email.verify', scope: 'ACCOUNT' });
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 401) return await passwordPath();
      throw e;
    }

    const userId = request.user?.userId;

    if (!userId) {
      return NextResponse.json({ error: AuthMessages.USER_NOT_AUTHENTICATED }, { status: 401 });
    }

    const parsedData = VerifyEmailDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        error: parsedData.error.issues.map(err => err.message).join(", ")
      }, { status: 400 });
    }

    await AuthService.verifyEmail({ userId, token: parsedData.data.token });

    return NextResponse.json({ message: AuthMessages.EMAIL_VERIFIED_SUCCESSFULLY }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
