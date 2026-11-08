// path: app/tenant/[tenantId]/api/domains/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantDomainService from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { CreateTenantDomainDTO, ListTenantDomainsQuery } from "@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.dto";
import { readListQuery } from "@kuraykaraaslan-labs/common/server/common.list-query";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/domains
 * Get all domains for a tenant, with `freeSubdomain`, `wildcardDomain` and
 * `customDomains` ({ allowed, maxDomains } from the plan) for the page header
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.read', scope: 'TENANT' });

    // phase 43 list contract: domain and certificate states, the primary flag, a search over the host name, a whitelisted
    // sort. tenant_domain.06 stays: page / pageSize are positive integers (pageSize at most 100), anything else the default.
    const q = readListQuery(new URL(request.url).searchParams, ListTenantDomainsQuery);
    const { page, pageSize } = q;

    const [result, overview] = await Promise.all([
      TenantDomainService.getByTenantId({
        tenantId, page, pageSize, domainStatus: q.domainStatus, sslStatus: q.sslStatus, isPrimary: q.isPrimary, search: q.search, sort: q.sort,
      }),
      // The free subdomain and the plan's custom-domain allowance, for the page's header (never fails the list).
      TenantDomainService.getOverview(tenantId).catch(() => null),
    ]);

    return NextResponse.json({
      success: true,
      ...result,
      // `data` is the list contract's name of the rows (phase 43); `domains` stays for older readers
      data: result.domains,
      ...(overview ?? {}),
    });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/domains
 * Add a new domain to a tenant
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.create', scope: 'TENANT' });

    const body = await request.json();
    const parsed = CreateTenantDomainDTO.safeParse({ ...body, tenantId });

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        message: "Invalid domain data",
        errors: parsed.error.issues
      }, { status: 400 });
    }

    const domain = await TenantDomainService.create(parsed.data);
    // tenant_domain.05: who added the domain.
    await AuditLogService.log({
      tenantId, actorType: 'USER', actorId: user.userId, action: 'domain.created',
      resourceType: 'tenant_domain', resourceId: domain.tenantDomainId, metadata: { domain: domain.domain },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      domain
    });
  } catch (e) {
    return normalizeError(e);
  }
}
