// path: app/tenant/[tenantId]/api/auth/onboarding/slug/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import { isRootTenant } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth/onboarding/slug?slug=acme — may a new organization take this address? Asked while
 * the person types in the onboarding (root tenant only, ACCOUNT scope). Answers `{ slug, available, reason? }`
 * (`invalid` | `reserved` | `taken`): the same checks the create makes, which still decides (a race is a 409 there).
 * Signed-in only, so the slug space cannot be enumerated anonymously; rate-limited like every route.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    if (!isRootTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'auth.onboarding.read', scope: 'ACCOUNT' });
    const slug = (request.nextUrl.searchParams.get('slug') ?? '').trim().toLowerCase().slice(0, 64);
    const result = await TenantService.slugAvailability(slug);
    return NextResponse.json({ slug, ...result }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
