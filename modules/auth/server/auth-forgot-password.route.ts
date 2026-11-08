import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import PasswordService from "@kuraykaraaslan-labs/auth/server/auth.password.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { ForgotPasswordDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { resolveLocale } from "@kuraykaraaslan-labs/auth/server/auth.i18n";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth', 'forgot');
    // Public route governed by ABAC (GUEST floor; permit-by-default, admin policy may deny).
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.account.forgot_password', scope: 'GUEST' });

    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const parsedData = ForgotPasswordDTO.safeParse(await request.json());
    if (!parsedData.success) {
      return NextResponse.json({
        error: parsedData.error.issues.map((err) => err.message).join(', '),
      }, { status: 400 });
    }

    const locale = resolveLocale(request.headers.get('accept-language'));
    await PasswordService.forgotPassword({ email: parsedData.data.email, tenantId, locale });

    return NextResponse.json({ message: AuthMessages.FORGOT_PASSWORD_SUCCESSFUL }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
