// path: app/tenant/[tenantId]/api/domains/report/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantDomainService from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/domains/report
 * Domain-health / SSL-expiry / DNS-verification-age report for the tenant.
 * NOTE: declared BEFORE /api/domains/[domainId] so 'report' is not shadowed
 * as a domainId segment.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.reports', scope: 'TENANT' });

    const report = await TenantDomainService.getReport(tenantId);

    return NextResponse.json({ success: true, report });
  } catch (e) {
    return normalizeError(e);
  }
}
