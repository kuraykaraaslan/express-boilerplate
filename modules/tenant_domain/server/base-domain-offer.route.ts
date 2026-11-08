// path: app/tenant/[tenantId]/api/base-domain-offer/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { isRootTenant } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { baseDomainOffer } from "./tenant_domain.base-domain-choice";

/**
 * GET /tenant/[tenantId]/api/base-domain-offer?slug=acme — which base domains a new organization's address may use (phase 56, D346), asked
 * by the onboarding page on the root tenant (ACCOUNT scope, signed in, like the address check beside it). Answers
 * `{ choice, defaultBase, offered, takenUnder }`: with `choice: 'platform'` the page shows no picker and `offered` is the default alone;
 * `takenUnder` lists the offered bases under which `<slug>.<base>` is already held. The create still decides.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    if (!isRootTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant_domain.base_domains.offer', scope: 'ACCOUNT' });
    const slug = (request.nextUrl.searchParams.get('slug') ?? '').trim().toLowerCase().slice(0, 63);
    return NextResponse.json(await baseDomainOffer(slug || null), { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
