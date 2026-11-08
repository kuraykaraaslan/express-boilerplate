// path: app/tenant/[tenantId]/api/modules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { listModulesWithState } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/modules
 * Lists every module with its per-tenant enabled state. Admin-only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.modules.read', scope: 'TENANT' });

    const modules = await listModulesWithState(tenantId);
    return NextResponse.json({ success: true, modules });
  } catch (e) {
    return normalizeError(e);
  }
}

/*
 * There is deliberately NO write endpoint here.
 *
 * This route used to expose `PUT { id, enabled }` straight onto
 * `setModuleEnabled`, which is the raw settings write with no entitlement check
 * in front of it. Because the runtime gate (`getEnabledModuleIds`) reads only
 * that setting, any holder of `tenant_setting.modules.update` could switch on a
 * module the tenant had not paid for even with monetization enabled, and could
 * do it without an install-ledger row, without a recorded version, and without the
 * `onInstall`/`onEnable` lifecycle hooks ever running.
 *
 * Module writes now go through the marketplace, which owns the install ledger,
 * the dependency closure, the lifecycle hooks and the entitlement gate:
 *   POST   /api/marketplace/[moduleId]/install
 *   PUT    /api/marketplace/[moduleId]   { active }
 *   DELETE /api/marketplace/[moduleId]   { cascade? }
 *
 * `setModuleEnabled` stays exported for those callers only.
 */
