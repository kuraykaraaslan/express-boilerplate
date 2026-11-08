// path: app/tenant/[tenantId]/api/audit-logs/route.ts
import type { AuditSeverity } from './audit_log.enums';
import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { assertAuditLogEntitled } from './audit_log.entitlement';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { dayEnd, dayStart } from './audit_log.list-params';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/audit-logs
 * List audit logs scoped to this tenant (requires ADMIN role).
 *
 * Query params: page, pageSize, actorId, action, severity, resourceType,
 * resourceId, fromDate, toDate, actorTenantId (a tenant id, or `any` for rows
 * written by an actor from another tenant)
 *
 * pageSize is clamped server-side to the tenant's `auditLogMaxPageSize`
 * setting (default 100, hard cap 500) — see audit_log.query.ts#resolveMaxPageSize.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor ADMIN (audit_log.logs.read)
    await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.read', scope: 'TENANT' });
    await assertAuditLogEntitled(tenantId);

    const { searchParams } = new URL(request.url);

    const { logs, total } = await AuditLogService.getAll({
      tenantId,
      actorId: searchParams.get('actorId') ?? undefined,
      actorTenantId: searchParams.get('actorTenantId') ?? undefined,
      // The list's search box searches the action name.
      action: searchParams.get('action') ?? searchParams.get('search') ?? undefined,
      severity: (searchParams.get('severity') as AuditSeverity | null) ?? undefined,
      resourceType: searchParams.get('resourceType') ?? undefined,
      resourceId: searchParams.get('resourceId') ?? undefined,
      // `createdFrom` / `createdTo` are whole UTC days (the table's date filter); `fromDate` / `toDate` stay instants.
      fromDate: searchParams.get('fromDate') ?? dayStart(searchParams.get('createdFrom')),
      toDate: searchParams.get('toDate') ?? dayEnd(searchParams.get('createdTo')),
      sort: searchParams.get('sort') || undefined,
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1,
      pageSize: searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 20,
    });

    return NextResponse.json({ logs, total }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
