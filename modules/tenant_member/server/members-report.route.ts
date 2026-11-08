// path: app/tenant/[tenantId]/api/members/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

type Params = { params: Promise<{ tenantId: string }> };

/**
 * GET /tenant/[tenantId]/api/members/report
 * Members-by-role and members-by-status aggregation (requires ADMIN role).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'members.reports', scope: 'TENANT' });

    const stats = await TenantMemberService.getMemberStats(tenantId);

    return NextResponse.json(stats, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
