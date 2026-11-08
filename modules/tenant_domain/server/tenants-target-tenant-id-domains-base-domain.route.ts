// path: app/tenant/[tenantId]/api/tenants/[targetTenantId]/domains/base-domain/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { ROOT_TENANT_ID } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { ChangeBaseDomainDTO } from "./tenant_domain.dto";
import { changeTenantBaseDomain } from "./tenant_domain.base-domain-choice";
import { baseDomainList, isMintableBase } from "./tenant_domain.base-domains";

/**
 * GET  /tenant/[tenantId]/api/tenants/[targetTenantId]/domains/base-domain — the bases the operator may move this organization to (every
 * ACTIVE tenants' base, selectable or not).
 * POST `{ baseDomain }` — the root tenant's operator moves any organization's free subdomain to another base domain (phase 56, D347),
 * whatever `baseDomainChoice` says. A rename: the old address redirects for 30 days. Same permission and scope as editing the tenant.
 */
export async function GET(request: NextRequest, _ctx: { params: Promise<{ tenantId: string; targetTenantId: string }> }) {
  try {
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant.tenants.read', scope: 'GLOBAL' });
    const bases = (await baseDomainList()).filter(isMintableBase).map((b) => b.baseDomain);
    return NextResponse.json({ bases }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; targetTenantId: string }> }) {
  try {
    const { targetTenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant.tenants.update', scope: 'GLOBAL' });
    const parsed = ChangeBaseDomainDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const change = await changeTenantBaseDomain(targetTenantId, parsed.data.baseDomain, 'root');
    if (change.changed) {
      await AuditLogService.log({
        tenantId: ROOT_TENANT_ID, actorType: 'USER', actorId: user.userId, action: 'domain.base_changed',
        resourceType: 'tenant', resourceId: targetTenantId, metadata: { from: change.previousDomain, to: change.domain },
      }).catch(() => {});
    }
    return NextResponse.json({ success: true, ...change });
  } catch (e) {
    return normalizeError(e);
  }
}
