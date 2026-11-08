// path: app/tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/modules/[moduleId]/policy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { blockModule, unblockModule } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.service';
import {
  assertCustomerTenant,
  describeTenantModules,
  logOperatorAction,
} from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.console';

/**
 * PUT /tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/modules/[moduleId]/policy
 *   { blocked: boolean, reason?: string }
 * Block a module for one customer tenant (it cannot install or reactivate it; an
 * active copy is closed with its dependents, data kept) or lift the block (which
 * reactivates nothing). Platform admin (GLOBAL scope) only
 * (docs/phases/25-marketplace/03-module-governance/04).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string; moduleId: string }> },
) {
  try {
    const { targetTenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.manage', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { blocked?: unknown; reason?: unknown };
    if (typeof body.blocked !== 'boolean') {
      return NextResponse.json({ success: false, message: 'Body must be { blocked: boolean, reason?: string }' }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : null;
    const result = body.blocked
      ? await blockModule(targetTenantId, moduleId, reason, user?.userId)
      : { unblocked: await unblockModule(targetTenantId, moduleId, user?.userId) };
    await logOperatorAction(user?.userId, body.blocked ? 'block' : 'unblock', targetTenantId, { moduleId, reason, ...result });
    return NextResponse.json({ success: true, result, modules: await describeTenantModules(targetTenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
