// path: app/tenant/[tenantId]/api/invitations/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantInvitationService from "@kuraykaraaslan-labs/tenant_invitation/server/tenant_invitation.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/invitations/report
 * Invitation lifecycle report: per-status counts, acceptance rate, oldest pending (ADMIN+)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: "tenant_invitation.invitations.reports", scope: 'TENANT' });

    const report = await TenantInvitationService.getReport(tenantId);

    return NextResponse.json({ report }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
