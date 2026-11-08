// path: app/tenant/[tenantId]/api/auth/totp/enable/route.ts
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import TOTPService from "@kuraykaraaslan-labs/auth/server/auth.totp.service";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { TOTPEnableDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { assertNotImpersonating } from "@kuraykaraaslan-labs/auth/server/auth.step-up";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');

    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'auth.me.totp.enable', scope: 'ACCOUNT' });
    // auth_impersonation.02: an impersonation session never enables a factor on the account it borrows (the setup steps up).
    assertNotImpersonating({ user, userSession });
    // auth.14: the tenant is looked up AFTER the guard, so an anonymous caller cannot tell an active tenant from a suspended or missing one.
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: user.userId });
    if (!tenantMember || tenantMember.memberStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'You are not a member of this organization' }, { status: 403 });
    }

    const body = await request.json();

    const parsedData = TOTPEnableDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        message: parsedData.error.issues.map((err: any) => err.message).join(", ")
      }, { status: 400 });
    }

    const { otpToken } = parsedData.data;

    const result = await TOTPService.verifyAndEnable({ user, userSession, otpToken });
    // Phase 55 00.4: the authenticator app was added: one `security.mfa_enabled` row and webhook (the factor in `method`). Best-effort.
    void Promise.resolve().then(() => UserSecurityService.emitMfaChanged(tenantId, user.userId, true, { method: 'TOTP_APP' })).catch(() => {});

    return NextResponse.json({ message: AuthMessages.TOTP_ENABLED_SUCCESSFULLY, backupCodes: result.backupCodes });
  } catch (e) {
    return normalizeError(e);
  }
}
