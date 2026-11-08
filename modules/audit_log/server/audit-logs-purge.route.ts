// path: app/tenant/[tenantId]/api/audit-logs/purge/route.ts
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

const PurgeBody = z.object({ archive: z.boolean().optional() });

/**
 * POST /tenant/[tenantId]/api/audit-logs/purge
 * Run the retention purge for this tenant (requires ADMIN role). Deletes rows
 * older than `auditLogRetentionDays`; no-op when retention is keep-forever.
 * Body (optional): { archive?: boolean } — serialize the batch to NDJSON first.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor OWNER — deleting audit rows
    // is irreversible & compliance-critical (intentional narrowing from ADMIN).
    // (audit_log.logs.purge)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.purge', scope: 'TENANT' });

    // Validated and stripped (38-security 6.3); a malformed body means the defaults, as before.
    const body = PurgeBody.safeParse(await request.json().catch(() => ({}))).data ?? {};
    const result = await AuditLogService.purgeExpired({ tenantId, archive: Boolean(body?.archive) });

    // A purge is itself audited (audit_log.01, fixed 2026-10-20): who removed how many rows up to which cutoff. Written
    // after the delete, so the row survives the purge it records.
    if (result.purged > 0) {
      await AuditLogService.log({
        tenantId, actorId: user.userId, actorType: 'USER', action: 'audit_log.purged', resourceType: 'audit_log',
        metadata: { purged: result.purged, cutoff: result.cutoff ? new Date(result.cutoff).toISOString() : null, archived: Boolean(body?.archive) },
      });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
