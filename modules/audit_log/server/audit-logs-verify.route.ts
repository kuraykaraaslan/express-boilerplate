// path: app/tenant/[tenantId]/api/audit-logs/verify/route.ts
import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/audit-logs/verify
 * Verify the append-only hash chain for this tenant (requires ADMIN role).
 * Returns { ok, checked, brokenAt }.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor ADMIN (audit_log.logs.verify)
    await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.verify', scope: 'TENANT' });

    const result = await AuditLogService.verifyChain(tenantId);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
