// path: app/tenant/[tenantId]/api/settings/branding/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import TenantBrandingService from "./tenant_branding.service";
import { TenantBrandingInputSchema } from "./tenant_branding.types";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/settings/branding
 * Get branding settings for the tenant (tenant:admin)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: "tenant_branding.branding.read", scope: 'TENANT' });

    const branding = await TenantBrandingService.get(tenantId);

    return NextResponse.json({ branding }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PUT /tenant/[tenantId]/api/settings/branding
 * Update branding settings for the tenant (tenant:admin)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, tenantMember } = await authorizeRequest({ request, tenantId, requiredPermission: "tenant_branding.branding.update", scope: 'TENANT' });

    const body = await request.json();
    const parsed = TenantBrandingInputSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    // customJs runs as a <script> for every visitor of the tenant's pages, so only the workspace OWNER may write it
    // (F.branding.02, fixed 2026-10-20): an ADMIN must not be able to plant code that runs with the OWNER's session.
    if (parsed.data.customJs !== undefined && tenantMember?.memberRole !== 'OWNER') {
      return NextResponse.json({ message: "Only the workspace owner can change custom JavaScript" }, { status: 403 });
    }

    // tenant_branding.02 (fixed 2026-10-20): the change is audited with the caller as the actor.
    const branding = await TenantBrandingService.update(tenantId, parsed.data, user.userId);

    return NextResponse.json({ message: "Branding updated", branding }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/settings/branding
 * Reset all branding settings to defaults (tenant:owner)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: "tenant_branding.branding.reset", scope: 'TENANT' });

    // tenant_branding.02 (fixed 2026-10-20): the reset is audited with the caller as the actor.
    await TenantBrandingService.reset(tenantId, user.userId);

    return NextResponse.json({ message: "Branding reset to defaults" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
