// path: app/tenant/[tenantId]/api/auth/registration/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { registrationOpen } from "@kuraykaraaslan-labs/auth/server/auth.registration";
import { isRootTenant } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth/registration
 *
 * Public: may a visitor sign up here? The login page shows its "Sign up" link and the register page its form only when
 * `enabled`. `onboarding` marks the platform sign-up (root tenant), after which the new account opens its own
 * organization. A tenant that is missing or not ACTIVE answers `enabled: false`, like a closed one, so the answer does
 * not say which tenant ids exist. Never cached: the switch can change at any time.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth.registration.read', scope: 'GUEST' });
    const tenant = await TenantService.getById(tenantId).catch(() => null);
    const enabled = !!tenant && tenant.tenantStatus === 'ACTIVE' && (await registrationOpen(tenantId));
    return NextResponse.json(
      { enabled, onboarding: enabled && isRootTenant(tenantId) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
