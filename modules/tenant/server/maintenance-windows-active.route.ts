import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import MaintenanceService from '@kuraykaraaslan-labs/tenant/server/maintenance.service';
import { MAINTENANCE_PERM, canManageSystemWindows } from '@kuraykaraaslan-labs/tenant/server/maintenance.route.helpers';

/**
 * The root tenant's `maintenanceMode` kill-switch, read the way proxy/maintenance.ts reads it (41-ui-fixes/09 B2.5):
 * admins pass it with any session, so without this flag nothing tells them signed-out visitors see the notice.
 * An unreadable setting reads as off, like the proxy's fail-open.
 */
async function platformKillSwitchOn(): Promise<boolean> {
  try {
    return (await SettingService.getByKeys(ROOT_TENANT_ID, ['maintenanceMode']))?.maintenanceMode === 'true';
  } catch {
    return false;
  }
}

/**
 * GET /tenant/[tenantId]/api/maintenance-windows/active (41-ui-fixes/09 B3.2)
 * The windows gating this tenant NOW, decided on the server with the gate's own rule (candidates + time), plus the
 * platform kill-switch. The admin shell strip and the console's red banner both read this, so a live window can never
 * fall off a list page or a browser clock. Each window says how far it reaches (mode, routes, canary share) and whether
 * this caller may end it: a SYSTEM window takes a platform admin, like the write routes.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });
    const canManageSystem = canManageSystemWindows(auth.user.userRole);

    const [active, platformKillSwitch] = await Promise.all([
      MaintenanceService.activeFor(tenantId),
      platformKillSwitchOn(),
    ]);
    const data = active.map((w) => ({
      windowId: w.windowId,
      tenantId: w.tenantId,
      title: w.title,
      scope: w.scope,
      mode: w.mode,
      status: w.status,
      scheduledStart: w.scheduledStart,
      scheduledEnd: w.scheduledEnd,
      percentage: w.percentage,
      routePatterns: w.routePatterns,
      canEnd: w.tenantId === tenantId || (w.tenantId === null && canManageSystem),
    }));
    return NextResponse.json({ success: true, data, platformKillSwitch, canManageSystem });
  } catch (e) {
    return normalizeError(e);
  }
}
