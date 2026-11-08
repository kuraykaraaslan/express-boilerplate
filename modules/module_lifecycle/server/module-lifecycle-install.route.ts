// path: app/tenant/[tenantId]/api/marketplace/[moduleId]/install/route.ts
// (module_lifecycle serves the same /api/marketplace/* paths the storefront always used — MIS-01: the path does not move with the module)
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { install } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.service';
import { listCatalog } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.catalog';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/marketplace/[moduleId]/install
 * Installs a module (and its required deps) and activates it. Admin-only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; moduleId: string }> },
) {
  try {
    const { tenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const session = await authorizeRequest({ request, tenantId, requiredPermission: 'marketplace.modules.install', scope: 'TENANT' });

    await install(tenantId, moduleId, session?.user?.userId);
    const modules = await listCatalog(tenantId);
    return NextResponse.json({ success: true, modules });
  } catch (e) {
    return normalizeError(e);
  }
}
