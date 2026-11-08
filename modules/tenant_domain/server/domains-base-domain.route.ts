// path: app/tenant/[tenantId]/api/domains/base-domain/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { ChangeBaseDomainDTO } from "./tenant_domain.dto";
import { baseDomainOffer, changeTenantBaseDomain } from "./tenant_domain.base-domain-choice";

/**
 * GET  /tenant/[tenantId]/api/domains/base-domain — what the organization may move its address to (the domains page's "Change base
 * domain" button shows only while `choice` is `tenant` and more than one base is offered).
 * POST /tenant/[tenantId]/api/domains/base-domain `{ baseDomain }` — the owner moves the organization's free subdomain to another offered
 * base domain (phase 56, D347): a rename, the old address redirecting for 30 days. Refused (403) while the root tenant keeps the choice.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.read', scope: 'TENANT' });
    const { choice, offered } = await baseDomainOffer();
    return NextResponse.json({ choice, offered }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_domain.domains.change_base', scope: 'TENANT' });
    const parsed = ChangeBaseDomainDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const change = await changeTenantBaseDomain(tenantId, parsed.data.baseDomain, 'owner');
    if (change.changed) {
      await AuditLogService.log({
        tenantId, actorType: 'USER', actorId: user.userId, action: 'domain.base_changed',
        resourceType: 'tenant_domain', resourceId: tenantId, metadata: { from: change.previousDomain, to: change.domain },
      }).catch(() => {});
    }
    return NextResponse.json({ success: true, ...change });
  } catch (e) {
    return normalizeError(e);
  }
}
