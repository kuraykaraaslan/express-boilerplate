// path: app/tenant/[tenantId]/api/audit-logs/cross-tenant/route.ts
import type { AuditSeverity } from './audit_log.enums';
import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { dayEnd, dayStart } from './audit_log.list-params';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AuditLogMessages from './audit_log.messages';

/**
 * GET /tenant/[tenantId]/api/audit-logs/cross-tenant
 * Cross-tenant aggregated audit view — ROOT TENANT ONLY (the service rejects
 * non-root callers). Requires ADMIN role on the root tenant.
 * Query params: tenantId, action, severity, fromDate, toDate, page, pageSize
 * (page * pageSize is capped at CROSS_TENANT_MAX_DEPTH).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor OWNER — cross-tenant read
    // from a tenant guard (root-tenant-only, enforced in service). Intentional
    // narrowing from ADMIN. (audit_log.logs.read_cross_tenant)
    await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.read_cross_tenant', scope: 'TENANT' });
    // Placed root (docs/phases/46-module-placement): the dispatcher serves it to ROOT only, and the route refuses anyone
    // else itself, as the service does, before anything is read.
    if (!isRootTenant(tenantId)) throw new AppError(AuditLogMessages.ROOT_ONLY, 403, ErrorCode.FORBIDDEN);

    const { searchParams } = new URL(request.url);

    const { logs, total, hasMore } = await AuditLogService.queryCrossTenant(tenantId, {
      tenantId: searchParams.get('filterTenantId') ?? undefined,
      // The list's search box searches the action name.
      action: searchParams.get('action') ?? searchParams.get('search') ?? undefined,
      severity: (searchParams.get('severity') as AuditSeverity | null) ?? undefined,
      // `createdFrom` / `createdTo` are whole UTC days (the table's date filter); `fromDate` / `toDate` stay instants.
      fromDate: searchParams.get('fromDate') ?? dayStart(searchParams.get('createdFrom')),
      toDate: searchParams.get('toDate') ?? dayEnd(searchParams.get('createdTo')),
      sort: searchParams.get('sort') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
      pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 20,
    });

    // `total` is capped (see queryCrossTenant); `hasMore` says rows exist past this page.
    return NextResponse.json({ logs, total, hasMore }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
