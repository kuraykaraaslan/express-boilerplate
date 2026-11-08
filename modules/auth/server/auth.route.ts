// path: app/tenant/[tenantId]/api/auth/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth
 * Check if user is authenticated and member of tenant
 * Returns tenant and member info if authenticated
 */
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

    return NextResponse.json({
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        userRole: user.userRole
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
      }
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
