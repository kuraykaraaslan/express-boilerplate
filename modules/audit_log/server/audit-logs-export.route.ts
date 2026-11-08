// path: app/tenant/[tenantId]/api/audit-logs/export/route.ts
import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { assertAuditLogEntitled } from './audit_log.entitlement';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/audit-logs/export?format=csv|ndjson
 * Bulk export of all (non-deleted) audit rows for this tenant (ADMIN role).
 * Optional query params: actorId (per-user SAR export), fromDate, toDate.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor ADMIN (audit_log.logs.export)
    await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.export', scope: 'TENANT' });
    await assertAuditLogEntitled(tenantId);

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') === 'csv' ? 'csv' : 'ndjson';

    const { body, count, truncated } = await AuditLogService.exportLogs({
      tenantId,
      actorId: searchParams.get('actorId') ?? undefined,
      fromDate: searchParams.get('fromDate') ?? undefined,
      toDate: searchParams.get('toDate') ?? undefined,
      format,
    });

    const contentType = format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8';
    const filename = `audit-logs-${tenantId}.${format === 'csv' ? 'csv' : 'ndjson'}`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Total-Count': String(count),
        ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
      },
    });
  } catch (e) {
    return normalizeError(e);
  }
}
