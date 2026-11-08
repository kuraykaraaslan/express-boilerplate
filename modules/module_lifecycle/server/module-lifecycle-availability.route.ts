// path: app/tenant/[tenantId]/api/module-lifecycle/availability/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { describeAvailability } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.console';
import { getPlatformDefaultModules } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.defaults';

/**
 * GET /tenant/[ROOT]/api/module-lifecycle/availability
 * Every tenant-installable module with its platform availability (available /
 * unlisted / hidden / retired) and how many customer tenants have it, plus the
 * default-module list. Platform admin (GLOBAL scope, behind the KD-13 IP/MFA
 * gate) only (docs/phases/25-marketplace/03-module-governance/03).
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, requiredPermission: 'module_lifecycle.platform.manage', scope: 'GLOBAL' });

    const [modules, defaultModules] = await Promise.all([describeAvailability(), getPlatformDefaultModules()]);
    return NextResponse.json({ success: true, modules, defaultModules });
  } catch (e) {
    return normalizeError(e);
  }
}
