import Logger from '@kuraykaraaslan-labs/logger';
import { NextRequest, NextResponse } from "next/server";
import TenantService from "@kuraykaraaslan-labs/tenant/server/tenant.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import { subscriptionHealthOf } from './tenant.extension-points';
import { CreateTenantRequestDTO, ListTenantsQuery } from './tenant.dto';
import { operatorCreateCountryFromRequest } from './tenant.country.detect';
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET handler for retrieving all tenants (root-tenant admins only).
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant.tenants.read', scope: 'GLOBAL' });

    // phase 43 list contract: sort, statuses, regions, a created-day range, a search over name and slug. tenant.04 (fixed
    // 2026-10-20) stays: page (0-based) and pageSize are clamped before the query, 0 <= page <= 100 000, 1 <= pageSize <= 200.
    const q = readListQuery(new URL(request.url).searchParams, ListTenantsQuery);
    const { page, pageSize } = q;

    Logger.info('Fetching tenants with', { page, pageSize, search: q.search ?? null });

    const { tenants, total } = await TenantService.getAll({
      page,
      pageSize,
      search: q.search ?? null,
      tenantId: null,
      sort: q.sort,
      tenantStatus: q.tenantStatus,
      region: q.region,
      countryCode: q.countryCode,
      createdFrom: q.createdFrom,
      createdTo: q.createdTo,
    });

    Logger.info(`Fetched ${tenants.length} tenants (total: ${total})`);

    // Enrich with subscription health. The module that sells plans contributes it (`tenant:subscription_health`); without it every tenant
    // that is not suspended or pending deletion reads `no_subscription`.
    const health = await subscriptionHealthOf(tenants.map((t: { tenantId: string }) => t.tenantId));

    function computeHealthStatus(tenant: { tenantId: string; tenantStatus: string }): string {
      if (tenant.tenantStatus === 'SUSPENDED') return 'suspended';
      if (tenant.tenantStatus === 'PENDING_DELETION') return 'pending_deletion';
      return health[tenant.tenantId] ?? 'no_subscription';
    }

    const enrichedTenants = tenants.map((t: { tenantId: string; tenantStatus: string }) => ({
      ...t,
      healthStatus: computeHealthStatus(t),
    }));

    // `data` is the list contract's name of the rows (phase 43); `tenants` stays for older readers
    return NextResponse.json({ tenants: enrichedTenants, data: enrichedTenants, total, page, pageSize });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST handler for creating a new tenant (root-tenant admins only).
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant.tenants.create', scope: 'GLOBAL' });

    // tenant.03 (fixed 2026-10-20): validated before the row is saved (a missing name used to be saved, then fail the response parse).
    const parsed = CreateTenantRequestDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    const body = parsed.data;

    const tenant = await TenantService.create({
      name: body.name,
      description: body.description || null,
      region: body.region || 'TR',
      ...(await operatorCreateCountryFromRequest(body, request)),
      // The shared DTO carries the slug now (03-auth 1.3); dropping it here would repeat that bug on this route.
      ...(body.slug ? { slug: body.slug } : {}),
    } as never);

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
