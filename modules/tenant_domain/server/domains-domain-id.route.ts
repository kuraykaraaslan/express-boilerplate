// path: app/tenant/[tenantId]/api/domains/[domainId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantDomainService from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AssignDomainSiteDTO } from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.dto";

/**
 * GET /tenant/[tenantId]/api/domains/[domainId]
 * Get domain details including verification info, and whether it is the
 * tenant's permanent free subdomain (`isFreeSubdomain`)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string, domainId: string }> }
) {
  try {
    const { tenantId, domainId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.read', scope: 'TENANT' });

    // Full row for the detail page. Verification records are best-effort — a
    // VERIFIED domain no longer has a pending challenge, so tolerate a failure
    // there instead of 409-ing the whole detail load.
    const domain = await TenantDomainService.getById(domainId, tenantId);
    let verification = null;
    try {
      verification = await TenantDomainService.getVerificationInfo(domainId, tenantId);
    } catch { /* no active challenge (e.g. already verified) */ }
    // The free subdomain is permanent: the page says so and offers no delete (the service refuses it anyway).
    const free = await TenantDomainService.getFreeSubdomainByTenantId(tenantId).catch(() => null);

    // phase 51.4: what the platform knows about the certificate it holds for this host (never the chain or the key); null when none and the
    // installation does not order its own. A lookup failure only hides the card, it does not fail the page.
    const certificate = await import('@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.certificates.view')
      .then((m) => m.certificateSummary(tenantId, domainId, domain.domain)).catch(() => null);

    return NextResponse.json({
      success: true,
      domain,
      verification,
      isFreeSubdomain: free?.tenantDomainId === domain.tenantDomainId,
      certificate,
    });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PATCH /tenant/[tenantId]/api/domains/[domainId]
 * Assign the domain to a site: `{ siteId }` (null = the tenant's default site).
 * This is deliberately the ONLY writable field here — status and primary changes
 * carry DNS-ownership rules and have their own paths.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string, domainId: string }> }
) {
  try {
    const { tenantId, domainId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.assign_site', scope: 'TENANT' });
    const parsed = AssignDomainSiteDTO.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const domain = await TenantDomainService.update(domainId, tenantId, { siteId: parsed.data.siteId });
    await AuditLogService.log({
      tenantId, actorType: 'USER', actorId: user.userId, action: 'domain.site_assigned',
      resourceType: 'tenant_domain', resourceId: domainId, metadata: { domain: domain.domain, siteId: parsed.data.siteId },
    }).catch(() => {});
    return NextResponse.json({ success: true, domain });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/domains/[domainId]
 * Remove a domain
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string, domainId: string }> }
) {
  try {
    const { tenantId, domainId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.delete', scope: 'TENANT' });

    await TenantDomainService.delete(domainId, tenantId);
    // tenant_domain.05: who removed the domain.
    await AuditLogService.log({
      tenantId, actorType: 'USER', actorId: user.userId, action: 'domain.deleted',
      resourceType: 'tenant_domain', resourceId: domainId,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Domain deleted successfully"
    });
  } catch (e) {
    return normalizeError(e);
  }
}
