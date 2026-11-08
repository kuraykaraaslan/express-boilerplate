import Logger from '@kuraykaraaslan-labs/logger';
// path: app/tenant/[tenantId]/api/auth/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { collectSessionExtensions } from "@kuraykaraaslan-labs/auth/server/auth.session-extension";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, userSession, tenant, tenantMember } = await authorizeRequest({
      request,
      tenantId,
      requiredPermission: 'auth.session.read',
      requiredTenantRole: 'USER',
      scope: 'TENANT'
    });

    Logger.info("[SESSION-API] Authenticated successfully:", user.email);

    // Sections satellites add to this answer (e.g. `compliance.pendingAgreements`).
    const extensions = await collectSessionExtensions(tenant.tenantId, user.userId);

    return NextResponse.json({
      ...extensions,
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        userRole: user.userRole,
      },
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.name,
        description: tenant.description,
        tenantStatus: tenant.tenantStatus,
      },
      tenantMember: {
        tenantMemberId: tenantMember.tenantMemberId,
        memberRole: tenantMember.memberRole,
        memberStatus: tenantMember.memberStatus,
      },
      message: AuthMessages.SESSION_RETRIEVED_SUCCESSFULLY
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
