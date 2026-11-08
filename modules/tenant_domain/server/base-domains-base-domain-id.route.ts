// path: app/tenant/[tenantId]/api/base-domains/[baseDomainId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { ROOT_TENANT_ID } from "@kuraykaraaslan-labs/common/server/tenant-constants";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { UpdateBaseDomainDTO } from "./tenant_domain.dto";
import { deleteBaseDomain, updateBaseDomain } from "./tenant_domain.base-domains.admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH  /tenant/[ROOT]/api/base-domains/[baseDomainId] `{ selectable?, isDefault?: true, challengeMode?, status?: DISABLED | PENDING_DNS }`
 * DELETE /tenant/[ROOT]/api/base-domains/[baseDomainId]
 * Root super-admin only (GLOBAL scope, `tenant_domain.base_domains.manage`), audited (phase 56, D351). The default is never switched off or
 * deleted, and a base that still holds addresses neither (409).
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string; baseDomainId: string }> }) {
  try {
    const { baseDomainId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant_domain.base_domains.manage', scope: 'GLOBAL' });
    if (!UUID.test(baseDomainId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    const parsed = UpdateBaseDomainDTO.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const row = await updateBaseDomain(baseDomainId, parsed.data);
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorType: 'USER', actorId: user.userId, action: 'base_domain.updated',
      resourceType: 'tenant_domain_base_domain', resourceId: baseDomainId, metadata: { baseDomain: row.baseDomain, ...parsed.data },
    }).catch(() => {});
    return NextResponse.json({ success: true, baseDomain: { baseDomainId: row.baseDomainId, baseDomain: row.baseDomain, status: row.status, isDefault: row.isDefault, selectable: row.selectable, challengeMode: row.challengeMode } });
  } catch (e) {
    return normalizeError(e);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string; baseDomainId: string }> }) {
  try {
    const { baseDomainId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, requiredPermission: 'tenant_domain.base_domains.manage', scope: 'GLOBAL' });
    if (!UUID.test(baseDomainId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
    await deleteBaseDomain(baseDomainId);
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorType: 'USER', actorId: user.userId, action: 'base_domain.deleted',
      resourceType: 'tenant_domain_base_domain', resourceId: baseDomainId,
    }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (e) {
    return normalizeError(e);
  }
}
