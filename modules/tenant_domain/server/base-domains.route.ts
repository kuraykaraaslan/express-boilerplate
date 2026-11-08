// path: app/tenant/[tenantId]/api/base-domains/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { ROOT_TENANT_ID } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { CreateBaseDomainDTO } from "./tenant_domain.dto";
import { createBaseDomain, listBaseDomainViews } from "./tenant_domain.base-domains.admin";
import { baseDomainChoice } from "./tenant_domain.base-domain-choice";

/**
 * GET  /tenant/[ROOT]/api/base-domains — the managed base domains with their DNS records to set, wildcard state and address counts, plus
 *      the root tenant's `baseDomainChoice` (phase 56, D351). Root super-admin only (GLOBAL scope, `tenant_domain.base_domains.read`).
 * POST `{ baseDomain, purpose?, challengeMode?, selectable? }` — add one, PENDING_DNS until its DNS is proven (`tenant_domain.base_domains.manage`).
 */
export async function GET(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, requiredPermission: 'tenant_domain.base_domains.read', scope: 'GLOBAL' });
    const [baseDomains, choice] = await Promise.all([listBaseDomainViews(), baseDomainChoice()]);
    return NextResponse.json({ baseDomains, choice }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant_domain.base_domains.manage', scope: 'GLOBAL' });
    const parsed = CreateBaseDomainDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const created = await createBaseDomain(parsed.data);
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorType: 'USER', actorId: user.userId, action: 'base_domain.created',
      resourceType: 'tenant_domain_base_domain', resourceId: created.baseDomainId, metadata: { baseDomain: created.baseDomain, purpose: created.purpose, challengeMode: created.challengeMode },
    }).catch(() => {});
    return NextResponse.json({ success: true, baseDomain: { baseDomainId: created.baseDomainId, baseDomain: created.baseDomain, status: created.status } }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
