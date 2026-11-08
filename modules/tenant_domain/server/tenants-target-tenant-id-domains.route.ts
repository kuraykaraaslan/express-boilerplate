// path: app/tenant/[tenantId]/api/tenants/[targetTenantId]/domains/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import TenantDomainService from "./tenant_domain.service";

/** The operator panel lists them all at once; a tenant has a handful of domains, never hundreds. */
const MAX_DOMAINS = 100;

/**
 * GET /tenant/[tenantId]/api/tenants/[targetTenantId]/domains
 * Root-tenant admin: the custom domains of any tenant, for the domains panel tenant_domain adds to the operator's
 * tenant page (`common:entity_panel`). Same permission and scope as reading the tenant itself.
 *
 * The route lives in the module it serves: `tenant` used to merge these into its own read model, which made it import
 * tenant_domain, a module that requires it back (docs/phases/37-extensions/10, 2026-10-17 second pass).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> }
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant.tenants.read', scope: 'GLOBAL' });
    const { domains, total } = await TenantDomainService.getByTenantId({ tenantId: targetTenantId, page: 1, pageSize: MAX_DOMAINS });
    return NextResponse.json({ domains, total }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
