// path: app/tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/modules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { assertCustomerTenant, describeTenantModules } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.console';

/**
 * GET /tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/modules
 * The operator's view of one customer tenant's modules: installed / on / where
 * the state comes from / plan coverage / availability / block / ledger drift.
 * Platform admin (GLOBAL scope) only
 * (docs/phases/25-marketplace/03-module-governance/05).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> },
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.read', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);
    return NextResponse.json({ success: true, modules: await describeTenantModules(targetTenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
