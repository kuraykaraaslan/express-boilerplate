// path: app/tenant/[tenantId]/api/domains/[domainId]/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantDomainService from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/domains/[domainId]/verify
 * Trigger DNS verification
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string, domainId: string }> }
) {
  try {
    const { tenantId, domainId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.verify', scope: 'TENANT' });

    const isVerified = await TenantDomainService.verifyDomain(domainId, tenantId);
    // tenant_domain.05: the status change itself is a SYSTEM row; this one names the member who triggered the check.
    await AuditLogService.log({
      tenantId, actorType: 'USER', actorId: user.userId, action: 'domain.verification_requested',
      resourceType: 'tenant_domain', resourceId: domainId, metadata: { verified: Boolean(isVerified) },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      isVerified,
      message: isVerified ? "Domain verified successfully" : "Verification failed. Please check your DNS settings."
    });
  } catch (e) {
    return normalizeError(e);
  }
}
