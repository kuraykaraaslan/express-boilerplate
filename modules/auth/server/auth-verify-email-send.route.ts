// path: app/tenant/[tenantId]/api/auth/verify-email/send/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuthService from "@kuraykaraaslan-labs/auth/server/auth.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { resolveLocale } from "@kuraykaraaslan-labs/auth/server/auth.i18n";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { noteVerifyEmailSent } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

/**
 * Email verification is an onboarding endpoint — the user may not yet be a
 * member of this tenant when verifying their address (especially during
 * self-registration). We only validate that the tenant exists and that the
 * caller is authenticated; tenant membership is NOT required.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request);

    await authorizeRequest({ request, requiredPermission: 'auth.me.email.verify', scope: 'ACCOUNT' });
    // auth.14: the tenant is looked up AFTER the guard, so an anonymous caller cannot tell an active tenant from a suspended or missing one.
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const userId = request.user?.userId;
    const email = request.user?.email;

    if (!userId || !email) {
      return NextResponse.json({ error: AuthMessages.USER_NOT_AUTHENTICATED }, { status: 401 });
    }

    const locale = resolveLocale(request.headers.get('accept-language'));
    await AuthService.sendEmailVerification({ userId, email, tenantId, locale });
    // Phase 55 02.6: a verification mail sent again is a signal for the AI firewall (tallied; never changes this answer).
    noteVerifyEmailSent(request, { tenantId, userId });

    return NextResponse.json({ message: AuthMessages.EMAIL_VERIFICATION_SENT }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
