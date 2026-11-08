import { NextRequest, NextResponse } from "next/server";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { CreateTenantRequestDTO } from "./tenant.dto";
import { operatorCreateCountryFromRequest } from "./tenant.country.detect";

/**
 * POST /tenant/[tenantId]/api/tenants/create
 * Root-tenant admin creates a new tenant and is added as the owner.
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant.tenants.create', scope: 'GLOBAL' });

    // tenant.03 (fixed 2026-10-20): the body is validated before the tenant row is created.
    const parsed = CreateTenantRequestDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        message: "Organization name is required (2 to 100 characters); slug must be 5 to 63 lowercase letters, digits and hyphens (no dot) and not reserved; description must be text and region a known region"
      }, { status: 400 });
    }
    const body = parsed.data;

    // 03-auth 1.3: the slug the person chose is stored; TenantService.create refuses a taken one (409) or a reserved one (422).
    const tenant = await TenantService.create({
      name: body.name,
      description: body.description?.trim() || null,
      region: body.region || 'TR',
      ...(await operatorCreateCountryFromRequest(body, request)),
      ...(body.slug ? { slug: body.slug } : {}),
    } as never, user.userId);

    // tenant.05 (fixed 2026-10-20): a tenant that cannot be given its OWNER is removed again, never left ownerless.
    try {
      await TenantMemberService.create({
        tenantId: tenant.tenantId,
        userId: user.userId,
        memberRole: 'OWNER',
        memberStatus: 'ACTIVE'
      });
    } catch (err) {
      try { await TenantService.discardUnowned(tenant.tenantId, user.userId); } catch { /* the original failure is what the caller sees */ }
      throw err;
    }

    return NextResponse.json({
      success: true,
      tenant: {
        tenantId: tenant.tenantId,
        name: tenant.name,
        description: tenant.description,
        tenantStatus: tenant.tenantStatus,
      },
      message: "Organization created successfully"
    }, { status: 201 });

  } catch (e) {
    return normalizeError(e);
  }
}
