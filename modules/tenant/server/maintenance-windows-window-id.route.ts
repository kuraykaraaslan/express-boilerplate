import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import MaintenanceService from '@kuraykaraaslan-labs/tenant/server/maintenance.service';
import { UpdateMaintenanceWindowDTO } from '@kuraykaraaslan-labs/tenant/server/maintenance.dto';
import {
  MAINTENANCE_PERM, auditMaintenance, assertCanManage, maintenanceCaller,
} from '@kuraykaraaslan-labs/tenant/server/maintenance.route.helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; windowId: string }> },
) {
  try {
    const { tenantId, windowId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });
    const window = await MaintenanceService.getWindow(windowId);
    // Reads follow the list: own windows + the SYSTEM windows gating us.
    if (window.tenantId !== tenantId && window.tenantId !== null) {
      throw new AppError('Maintenance window not found', 404, ErrorCode.NOT_FOUND);
    }
    return NextResponse.json({ success: true, data: window });
  } catch (e) {
    return normalizeError(e);
  }
}

/** PATCH /tenant/[tenantId]/api/maintenance-windows/[windowId] — edit / extend. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; windowId: string }> },
) {
  try {
    const { tenantId, windowId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });
    const existing = await MaintenanceService.getWindow(windowId);
    assertCanManage(existing, tenantId, auth.user.userRole);

    const data = UpdateMaintenanceWindowDTO.parse(await request.json());
    // 41-ui-fixes/09 B1.2/B1.4/B1.5: checked on the merged window, against the caller's role.
    const updated = await MaintenanceService.updateWindow(windowId, data, maintenanceCaller(auth));
    auditMaintenance(tenantId, auth.user.userId, 'tenant.maintenance.updated', windowId, {
      changed: Object.keys(data), scheduledEnd: updated.scheduledEnd,
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return normalizeError(e);
  }
}

/** DELETE /tenant/[tenantId]/api/maintenance-windows/[windowId] — cancel (never hard-deletes). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; windowId: string }> },
) {
  try {
    const { tenantId, windowId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });
    const existing = await MaintenanceService.getWindow(windowId);
    assertCanManage(existing, tenantId, auth.user.userRole);

    const cancelled = await MaintenanceService.cancelWindow(windowId);
    auditMaintenance(tenantId, auth.user.userId, 'tenant.maintenance.cancelled', windowId, {
      scope: cancelled.scope,
    });
    return NextResponse.json({ success: true, data: cancelled });
  } catch (e) {
    return normalizeError(e);
  }
}
