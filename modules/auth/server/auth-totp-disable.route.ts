// path: app/tenant/[tenantId]/api/auth/totp/disable/route.ts
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import TOTPService from "@kuraykaraaslan-labs/auth/server/auth.totp.service";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { TOTPDisableDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { secondFactorAttemptOf } from "@kuraykaraaslan-labs/auth/server/auth.second-factor.next";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');

    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'auth.me.totp.disable', scope: 'ACCOUNT' });
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

    const parsedData = TOTPDisableDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        message: parsedData.error.issues.map((err: any) => err.message).join(", ")
      }, { status: 400 });
    }

    const { otpToken } = parsedData.data;

    // Phase 55 00.5: a wrong code counts on this session (five end it), strikes this address on a human lane and is audited.
    await TOTPService.disable({ user, otpToken, attempt: secondFactorAttemptOf(request, { tenantId, flow: 'totp_disable', userSessionId: userSession?.userSessionId }) });
    // Phase 55 00.4: the authenticator app was removed: one `security.mfa_disabled` row (high) and webhook. Best-effort.
    void Promise.resolve().then(() => UserSecurityService.emitMfaChanged(tenantId, user.userId, false, { method: 'TOTP_APP' })).catch(() => {});

    return NextResponse.json({ message: AuthMessages.TOTP_DISABLED_SUCCESSFULLY });
  } catch (e) {
    return normalizeError(e);
  }
}
