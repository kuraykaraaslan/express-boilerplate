import { NextRequest, NextResponse } from "next/server";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import TenantDeletionService from "@kuraykaraaslan-labs/tenant/server/tenant.deletion.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { OperatorUpdateTenantDTO } from "./tenant.dto";

/**
 * GET /tenant/[tenantId]/api/tenants/[targetTenantId]
 * Root-tenant admin: get tenant details. (41-ui-fixes/09 A1.1) With the deletion schedule for the operator's console: `deleteAfter`,
 * `deletionRequestedAt`, `deletionRequestedBy` (null unless the tenant is PENDING_DELETION). They are added here only, not to
 * SafeTenant, which the tenant's own session and members read too. The status comes from the same uncached read, so it always
 * matches the schedule beside it; the deletion request and its cancel clear the cached profile too (tenant.deletion.service).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> }
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant.tenants.read', scope: 'GLOBAL' });
    const [tenant, deletion] = await Promise.all([
      TenantService.getById(targetTenantId),
      TenantDeletionService.deletionStatus(targetTenantId),
    ]);
    const pending = deletion?.tenantStatus === 'PENDING_DELETION';

    return NextResponse.json({
      tenant: {
        ...tenant,
        ...(deletion ? { tenantStatus: deletion.tenantStatus } : {}),
        deleteAfter: pending ? deletion.deleteAfter?.toISOString() ?? null : null,
        deletionRequestedAt: pending ? deletion.deletionRequestedAt?.toISOString() ?? null : null,
        deletionRequestedBy: pending ? deletion.deletionRequestedBy : null,
      },
    }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/tenants/[targetTenantId]
 * Root-tenant admin: update tenant details.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> }
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant.tenants.update', scope: 'GLOBAL' });
    // tenant.03 (fixed 2026-10-20): the body is validated before anything is written (it used to be written first and only the
    // response parse failed); a null / non-object body, an unknown status or region, or PENDING_DELETION is a 400.
    const parsed = OperatorUpdateTenantDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }
    const body = parsed.data;

    const tenant = await TenantService.update(targetTenantId, {
      name: body.name,
      description: body.description,
      tenantStatus: body.tenantStatus,
      region: body.region,
      countryCode: body.countryCode,
    } as never, user.userId);

    return NextResponse.json({ tenant, message: "Tenant updated successfully" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/tenants/[targetTenantId]
 * Root-tenant admin: soft-delete a tenant (sets `deletedAt`; no grace period, and the purge cascade never picks it up). The console
 * does not offer it (41-ui-fixes/09 A1.1): it schedules a deletion through `deletion-request`, which ends in the purge.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> }
) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant.tenants.delete', scope: 'GLOBAL' });
    await TenantService.delete(targetTenantId, user.userId);

    return NextResponse.json({ message: "Tenant deleted successfully" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
