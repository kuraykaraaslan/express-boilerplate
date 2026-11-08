// path: app/tenant/[tenantId]/api/domains/[domainId]/timeline/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantDomainService from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/domains/[domainId]/timeline
 * Verification / SSL activity timeline for one domain, read from the shared
 * audit-log (resourceType = 'tenant_domain'). Read-only cross-module read.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; domainId: string }> }
) {
  try {
    const { tenantId, domainId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.view_timeline', scope: 'TENANT' });

    // Ensure the domain exists AND belongs to this tenant before exposing logs.
    await TenantDomainService.getById(domainId, tenantId);

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);

    const { logs, total } = await AuditLogService.getAll({
      tenantId,
      resourceType: "tenant_domain",
      resourceId: domainId,
      page,
      pageSize,
    });

    return NextResponse.json({ success: true, logs, total });
  } catch (e) {
    return normalizeError(e);
  }
}
