// path: app/tenant/[tenantId]/api/module-lifecycle/tenants/[targetTenantId]/modules/[moduleId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import {
  install,
  setActive,
  purge,
  uninstall,
  previewDelete,
} from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.service';
import {
  assertCustomerTenant,
  describeTenantModules,
  logOperatorAction,
} from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.console';

// The operator acting on ONE module of ONE customer tenant, through the same single door as the
// tenant's own store (docs/phases/25-marketplace/03-module-governance/04, 05). Platform admin
// (GLOBAL scope: root-tenant super-admin behind the IP/MFA gate) only; the URL tenant is just the
// dispatcher mount. Every mutation is audited in the target tenant (actor = the sysadmin) and in ROOT.

type Ctx = { params: Promise<{ tenantId: string; targetTenantId: string; moduleId: string }> };

/** GET …?preview=delete — what an uninstall would purge, and which active modules block it. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { targetTenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.read', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);
    return NextResponse.json({ success: true, preview: await previewDelete(targetTenantId, moduleId) });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST — install the module on the tenant's behalf (origin 'operator'). The plan
 * still applies: to give a module the plan does not cover, grant the product
 * first (tenant_subscription's entitlement console), then install.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { targetTenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.manage', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);

    await install(targetTenantId, moduleId, user?.userId, { origin: 'operator' });
    await logOperatorAction(user?.userId, 'install', targetTenantId, { moduleId });
    return NextResponse.json({ success: true, modules: await describeTenantModules(targetTenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PUT { active: boolean } — activate or deactivate an installed module (data kept). */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { targetTenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.manage', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { active?: unknown };
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ success: false, message: 'Body must be { active: boolean }' }, { status: 400 });
    }
    await setActive(targetTenantId, moduleId, body.active, user?.userId, { origin: 'operator' });
    await logOperatorAction(user?.userId, body.active ? 'activate' : 'deactivate', targetTenantId, { moduleId });
    return NextResponse.json({ success: true, modules: await describeTenantModules(targetTenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE { cascade?: boolean, purge?: 'now', confirm?: string } — uninstall the module for the tenant. Restorable by
 * default, as the tenant's own uninstall is (EXT-4, docs/phases/37-extensions/08): it is off at once and its data is kept
 * for the restore window. `purge: 'now'` with `confirm` equal to the module id deletes the data now.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { targetTenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.tenant_modules.manage', scope: 'GLOBAL' });
    await assertCustomerTenant(targetTenantId);

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { cascade?: unknown; purge?: unknown; confirm?: unknown };
    const cascade = body.cascade === true;
    const purgeNow = body.purge === 'now';
    if (purgeNow && body.confirm !== moduleId) {
      return NextResponse.json({ success: false, message: `Type the module id ("${moduleId}") as confirm to delete its data now.` }, { status: 400 });
    }
    const result = purgeNow
      ? { ...(await purge(targetTenantId, moduleId, user?.userId, cascade, { requestedBy: 'operator' })), purged: true, restorableUntil: null }
      : await uninstall(targetTenantId, moduleId, user?.userId, cascade, { requestedBy: 'operator' });
    await logOperatorAction(user?.userId, 'uninstall', targetTenantId, { moduleId, ...result });
    return NextResponse.json({ success: true, result, modules: await describeTenantModules(targetTenantId) });
  } catch (e) {
    return normalizeError(e);
  }
}
