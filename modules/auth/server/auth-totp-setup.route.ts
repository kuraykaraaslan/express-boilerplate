// path: app/tenant/[tenantId]/api/auth/totp/setup/route.ts
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import TOTPService from "@kuraykaraaslan-labs/auth/server/auth.totp.service";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { TOTPSetupDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import UserSecurityService from "@kuraykaraaslan-labs/user_security/server/user_security.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { requireFactorEnrolmentStepUp } from "@kuraykaraaslan-labs/auth/server/auth.step-up.service";
import { noteTotpSetupStarted } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    await Limiter.checkRateLimit(request, 'auth');

    const { user, userSession } = await authorizeRequest({ request, requiredPermission: 'auth.me.totp.setup', scope: 'ACCOUNT' });
    // auth.14: the tenant is looked up AFTER the guard, so an anonymous caller cannot tell an active tenant from a suspended or missing one.
    const tenant = await TenantService.getById(tenantId);
    if (!tenant || tenant.tenantStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'Tenant not found or inactive' }, { status: 404 });
    }

    const body = await request.json();

    const parsedData = TOTPSetupDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json(
        { message: parsedData.error.issues.map((err: any) => err.message).join(", ") },
        { status: 400 }
      );
    }

    const tenantMember = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: user.userId });
    if (!tenantMember || tenantMember.memberStatus !== 'ACTIVE') {
      return NextResponse.json({ error: 'You are not a member of this organization' }, { status: 403 });
    }

    const userSecurity = await UserSecurityService.getSafeByUserId(user.userId);

    if (userSecurity.otpMethods.includes("TOTP_APP" as any)) {
      return NextResponse.json({ message: "TOTP already enabled" }, { status: 400 });
    }

    // auth_impersonation.02: an impersonation session never adds a factor, and a user who already holds one (a passkey) proves
    // it first. The pending secret this creates is what /totp/enable needs, so guarding the setup guards the enrolment.
    await requireFactorEnrolmentStepUp(request, { user, userSession }, { tenantId, purpose: 'auth.me.totp.setup' });

    const { secret, otpauthUrl } = await TOTPService.requestSetup({ user, userSession, tenantId }); // the tenant's MFA allow-list and issuer apply
    // Phase 55 02.6: a pending authenticator secret is a signal for the AI firewall (tallied; never changes this answer).
    noteTotpSetupStarted(request, { tenantId, userId: user.userId, userSessionId: userSession?.userSessionId ?? null });

    return NextResponse.json({ message: AuthMessages.TOTP_SETUP_INITIATED, secret, otpauthUrl });
  } catch (e) {
    return normalizeError(e);
  }
}
