// path: app/tenant/[tenantId]/api/audit-logs/anonymize/route.ts
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import AuditLogMessages from '@kuraykaraaslan-labs/audit_log/server/audit_log.messages';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { erasurePseudonym } from './audit_log.pseudonym';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

const AnonymizeBody = z.object({ actorId: z.string().min(1).max(64).optional() });

/**
 * POST /tenant/[tenantId]/api/audit-logs/anonymize
 * Right-to-erasure (GDPR Art. 17): pseudonymize an actor across the tenant's
 * audit trail (requires ADMIN role). Body: { actorId: string }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Authenticate + verify membership; ABAC floor OWNER — GDPR erasure is
    // irreversible (intentional narrowing from ADMIN). (audit_log.logs.anonymize)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'audit_log.logs.anonymize', scope: 'TENANT' });

    const body = AnonymizeBody.safeParse(await request.json().catch(() => ({}))).data ?? { actorId: undefined };
    if (!body.actorId) {
      return NextResponse.json({ message: AuditLogMessages.ACTOR_REQUIRED }, { status: 400 });
    }

    // audit_log.06 (fixed 2026-10-20): nobody erases their own attribution. Erasing the caller's own actor id would let the person
    // who just did something remove the trail of it; that erasure needs another OWNER.
    if (String(body.actorId) === String(user.userId)) {
      return NextResponse.json({ message: 'You cannot anonymize your own actor id; another owner must do it' }, { status: 403 });
    }

    const result = await AuditLogService.anonymizeActor({ tenantId, actorId: body.actorId });
    // The erasure is itself audited (audit_log.01, fixed 2026-10-20): who erased, and how many rows. The erased actor's id
    // is NOT written (that would undo the erasure); a one-way pseudonym lets the two be correlated.
    await AuditLogService.log({
      tenantId, actorId: user.userId, actorType: 'USER', action: 'audit_log.anonymized', resourceType: 'audit_log',
      metadata: { anonymized: result.anonymized, erasedActor: erasurePseudonym(String(body.actorId)) },
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
