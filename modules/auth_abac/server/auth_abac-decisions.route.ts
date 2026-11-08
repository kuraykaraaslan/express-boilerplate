import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from './auth_abac.guard.next';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth_abac/decisions — the decision log (admin).
 * Surfaces the `abac.decision` rows this module writes to the shared audit_log.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'auth_abac.decisions.read', scope: 'TENANT' });

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '25') || 25));

    const { logs, total } = await AuditLogService.getAll({
      tenantId,
      resourceType: 'abac_policy',
      action: 'abac.decision',
      page,
      pageSize,
    });
    return NextResponse.json({ logs, total }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
