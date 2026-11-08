// path: app/tenant/[tenantId]/api/module-lifecycle/default-modules/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import {
  getPlatformDefaultModules,
  setPlatformDefaultModules,
} from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.defaults';

/**
 * GET /tenant/[ROOT]/api/module-lifecycle/default-modules
 * The modules every NEW tenant is installed with. Platform admin (GLOBAL scope,
 * behind the KD-13 IP/MFA gate) only (docs/phases/25-marketplace/03-module-governance/01).
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'module_lifecycle.platform.manage', scope: 'GLOBAL' });
    return NextResponse.json({ success: true, moduleIds: await getPlatformDefaultModules() });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[ROOT]/api/module-lifecycle/default-modules  { moduleIds: string[] }
 * Replace the list. Every id must be a tenant-installable module (400 names the
 * bad ones). Existing tenants are not touched. Platform admin (GLOBAL) only.
 */
export async function PUT(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'module_lifecycle.platform.manage', scope: 'GLOBAL' });

    const body = ((await request.json().catch(() => ({}))) ?? {}) as { moduleIds?: unknown };
    if (!Array.isArray(body.moduleIds) || !body.moduleIds.every((id) => typeof id === 'string') || body.moduleIds.length > 200) {
      return NextResponse.json({ success: false, message: 'Body must be { moduleIds: string[] }' }, { status: 400 });
    }
    const moduleIds = await setPlatformDefaultModules(body.moduleIds as string[], user?.userId);
    return NextResponse.json({ success: true, moduleIds });
  } catch (e) {
    return normalizeError(e);
  }
}
