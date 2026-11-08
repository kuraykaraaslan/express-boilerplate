import { NextRequest, NextResponse } from "next/server";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { UpdateOwnTenantProfileDTO } from "@kuraykaraaslan-labs/tenant/server/tenant.dto";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/tenant/profile
 * Tenant admin: read the CALLING tenant's own identity (name/description, and its country read-only).
 *
 * Self-service counterpart to `/api/tenants/[targetTenantId]` (GLOBAL scope,
 * for a platform operator managing any tenant) — this one is TENANT-scoped
 * and only ever reads/writes the tenant the caller is already in.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant.tenants.read', scope: 'TENANT' });
    const tenant = await TenantService.getById(tenantId);

    // `countryCode` is read-only here (phase 49.1): the owner sees which country its prices follow, only the platform operator changes it
    return NextResponse.json({ name: tenant.name, description: tenant.description, countryCode: tenant.countryCode ?? null }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/tenant/profile
 * Tenant admin: rename their own workspace / edit its description.
 *
 * Deliberately narrower than the operator route: region, slug, tenantStatus
 * and metadata are not accepted here (see `UpdateOwnTenantProfileDTO`).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant.tenants.update', scope: 'TENANT' });
    const body = await request.json();
    const parsed = UpdateOwnTenantProfileDTO.parse(body);

    const tenant = await TenantService.update(tenantId, parsed, user.userId);

    return NextResponse.json({ name: tenant.name, description: tenant.description, message: "Profile updated successfully" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
