import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import MaintenanceService from '@kuraykaraaslan-labs/tenant/server/maintenance.service';
import { CreateMaintenanceWindowDTO, GetMaintenanceWindowsQuery } from '@kuraykaraaslan-labs/tenant/server/maintenance.dto';
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query';
import {
  MAINTENANCE_PERM, auditMaintenance, canManageSystemWindows, maintenanceCaller, assertMayScheduleScope,
} from '@kuraykaraaslan-labs/tenant/server/maintenance.route.helpers';

/**
 * GET /tenant/[tenantId]/api/maintenance-windows — the console's list. Always
 * includes SYSTEM (tenantId=null) windows: they gate this tenant too, and an
 * operator staring at a 503 must be able to SEE why (they just can't edit
 * them — that takes a platform ADMIN, enforced on the write routes).
 * `defaultAllowRoles` is the tenant's default bypass roles (never empty), the
 * create form's starting value.
 * `canManageSystem` tells the console whether to offer the SYSTEM writes at all (41-ui-fixes/09 B2.1).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });

    // phase 43 list contract; the tenant (and the SYSTEM branch) come from the path, never from the query
    const query = {
      ...readListQuery(request.nextUrl.searchParams, GetMaintenanceWindowsQuery.omit({ tenantId: true, includeSystem: true })),
      tenantId,
      includeSystem: true,
    };
    const [{ data, total }, defaultAllowRoles] = await Promise.all([
      MaintenanceService.listWindows(query),
      // The tenant's maintenanceDefaultAllowRoles (Maintenance → Settings): what the create form starts with.
      MaintenanceService.defaultAllowRoles(tenantId),
    ]);
    return NextResponse.json({ success: true, data, total, defaultAllowRoles, canManageSystem: canManageSystemWindows(auth.user.userRole) });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/maintenance-windows — schedule a window.
 * TENANT/ROUTE scopes are pinned to the path tenant (a member console cannot
 * freeze somebody else); SYSTEM scope — the whole platform — additionally
 * requires a platform ADMIN.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: MAINTENANCE_PERM, scope: 'TENANT' });

    const body = await request.json();
    const data = CreateMaintenanceWindowDTO.parse({
      ...body,
      tenantId: body?.scope === 'SYSTEM' ? undefined : tenantId,
    });
    assertMayScheduleScope(data.scope, auth.user.userRole);

    // 41-ui-fixes/09 B1.2: the service refuses a window that would lock the caller out of this console.
    const created = await MaintenanceService.createWindow(data, auth.user.userId, maintenanceCaller(auth));
    auditMaintenance(tenantId, auth.user.userId, 'tenant.maintenance.scheduled', created.windowId, {
      scope: created.scope, mode: created.mode, percentage: created.percentage,
      scheduledStart: created.scheduledStart, scheduledEnd: created.scheduledEnd,
    });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
