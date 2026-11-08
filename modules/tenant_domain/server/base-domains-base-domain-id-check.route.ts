// path: app/tenant/[tenantId]/api/base-domains/[baseDomainId]/check/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { ROOT_TENANT_ID } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { checkBaseDomain } from "./tenant_domain.base-domains.admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /tenant/[ROOT]/api/base-domains/[baseDomainId]/check — DNS check now: writes the verdict on the base and queues its wildcard order when a PENDING_DNS base passes (phase 56, D350, D351). Root super-admin only (GLOBAL scope,
 * `tenant_domain.base_domains.manage`), audited, no body.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; baseDomainId: string }> }) {
  try {
    const { baseDomainId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant_domain.base_domains.manage', scope: 'GLOBAL' });
    if (!UUID.test(baseDomainId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    const result = await checkBaseDomain(baseDomainId);
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorType: 'USER', actorId: user.userId, action: 'base_domain.dns_checked',
      resourceType: 'tenant_domain_base_domain', resourceId: baseDomainId,
    }).catch(() => {});
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return normalizeError(e);
  }
}
