// path: app/tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/default-modules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { applyDefaultModules } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.service';
import {
  assertCustomerTenant,
  describeTenantModules,
  logOperatorAction,
} from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.console';

/**
 * POST /tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/default-modules
 * Install the platform's default modules into an EXISTING tenant (a new tenant
 * gets them at creation). Same rules as at creation: plan check, origin
 * 'default', refusals reported. Platform admin (GLOBAL scope) only
 * (docs/phases/25-marketplace/03-module-governance/01, 05).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> },
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.manage', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);

    const result = await applyDefaultModules(targetTenantId, user?.userId);
    await logOperatorAction(user?.userId, 'apply_defaults', targetTenantId, { ...result });
    return NextResponse.json({ success: true, result, modules: await describeTenantModules(targetTenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
