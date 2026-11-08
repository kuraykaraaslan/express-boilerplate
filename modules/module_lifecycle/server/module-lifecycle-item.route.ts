// path: app/tenant/[tenantId]/api/marketplace/[moduleId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import {
  setActive,
  purge,
  uninstall,
  previewDelete,
} from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.service';
import { listCatalog } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.catalog';
import { assertNotHiddenFromTenant } from '@kuraykaraaslan-labs/module_lifecycle/server/module-lifecycle.hidden';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/marketplace/[moduleId]?preview=delete
 * Returns the tables/data that an uninstall would purge + blocking dependents.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; moduleId: string }> },
) {
  try {
    const { tenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    await authorizeRequest({ request, tenantId, requiredPermission: 'marketplace.modules.read', scope: 'TENANT' });
    assertNotHiddenFromTenant(tenantId, [moduleId]);

    const preview = await previewDelete(tenantId, moduleId);
    return NextResponse.json({ success: true, preview });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/marketplace/[moduleId]  { active: boolean }
 * Activates or deactivates an installed module (keeps data). Admin-only.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; moduleId: string }> },
) {
  try {
    const { tenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const session = await authorizeRequest({ request, tenantId, requiredPermission: 'marketplace.modules.activate', scope: 'TENANT' });

    const body = await request.json();
    const active = typeof body?.active === 'boolean' ? body.active : null;
    if (active === null) {
      return NextResponse.json(
        { success: false, message: 'Body must be { active: boolean }' },
        { status: 400 },
      );
    }

    // switching off is not gated like switching on: a module config/modules.ts hides is not the tenant's to switch either way
    assertNotHiddenFromTenant(tenantId, [moduleId]);
    await setActive(tenantId, moduleId, active, session?.user?.userId);
    const modules = await listCatalog(tenantId);
    return NextResponse.json({ success: true, modules });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/marketplace/[moduleId]  { cascade?: boolean, purge?: 'now', confirm?: string }
 * Uninstalls a module, restorably: it is switched off and its data kept until `restorableUntil`
 * (MODULE_RESTORE_WINDOW_DAYS); activating it again inside the window restores it. `purge: 'now'` with
 * `confirm` equal to the module id deletes the data at once (docs/phases/37-extensions/08). Admin-only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; moduleId: string }> },
) {
  try {
    const { tenantId, moduleId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const session = await authorizeRequest({ request, tenantId, requiredPermission: 'marketplace.modules.uninstall', scope: 'TENANT' });

    let cascade = false;
    let purgeNow = false;
    try {
      const body = await request.json();
      cascade = body?.cascade === true;
      if (body?.purge === 'now') {
        if (body?.confirm !== moduleId) {
          return NextResponse.json({ success: false, message: `Type the module id ("${moduleId}") as confirm to delete its data now.` }, { status: 400 });
        }
        purgeNow = true;
      }
    } catch { /* no body — restorable uninstall, no cascade */ }

    // The tenant's own uninstall (restorable, EXT-4) or purge-now: refused (409) for a module its plan installed while
    // the plan covers it (MG-7).
    const result = purgeNow
      ? { ...(await purge(tenantId, moduleId, session?.user?.userId, cascade, { requestedBy: 'tenant' })), purged: true, restorableUntil: null }
      : await uninstall(tenantId, moduleId, session?.user?.userId, cascade, { requestedBy: 'tenant' });
    const modules = await listCatalog(tenantId);
    return NextResponse.json({ success: true, result, modules });
  } catch (e) {
    return normalizeError(e);
  }
}
