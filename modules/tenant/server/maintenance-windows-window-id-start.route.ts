import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import MaintenanceService from '@kuraykaraaslan-labs/tenant/server/maintenance.service';
import { MAINTENANCE_PERM, auditMaintenance, assertCanManage, maintenanceCaller } from '@kuraykaraaslan-labs/tenant/server/maintenance.route.helpers';

/**
 * POST /tenant/[tenantId]/api/maintenance-windows/[windowId]/start
 * The emergency button: IN_PROGRESS now, without waiting for the schedule.
 * Cache purge inside the service makes the very next request see the 503.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; windowId: string }> },
) {
  try {
    const { tenantId, windowId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });
    const existing = await MaintenanceService.getWindow(windowId);
    assertCanManage(existing, tenantId, auth.user.userRole);
    // (41-ui-fixes/09 B1.2) starting puts the stored window live: refused (409) when it would 503 the caller's own console,
    // as a save with those roles is.
    MaintenanceService.assertCallerKeptIn(existing, maintenanceCaller(auth));

    const started = await MaintenanceService.startWindow(windowId);
    auditMaintenance(tenantId, auth.user.userId, 'tenant.maintenance.started', windowId, {
      scope: started.scope, mode: started.mode, forced: true,
    });
    return NextResponse.json({ success: true, data: started });
  } catch (e) {
    return normalizeError(e);
  }
}
