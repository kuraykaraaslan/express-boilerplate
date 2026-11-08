import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import MaintenanceService from '@kuraykaraaslan-labs/tenant/server/maintenance.service';
import { MAINTENANCE_PERM, auditMaintenance, assertCanManage } from '@kuraykaraaslan-labs/tenant/server/maintenance.route.helpers';

/**
 * POST /tenant/[tenantId]/api/maintenance-windows/[windowId]/end
 * The other emergency button — and the banner's one-click way out. The
 * service purges the gate cache, so the 503 lifts on the next request.
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

    const ended = await MaintenanceService.endWindow(windowId);
    auditMaintenance(tenantId, auth.user.userId, 'tenant.maintenance.ended', windowId, {
      scope: ended.scope,
    });
    return NextResponse.json({ success: true, data: ended });
  } catch (e) {
    return normalizeError(e);
  }
}
