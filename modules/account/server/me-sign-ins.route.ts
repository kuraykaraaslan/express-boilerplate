import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';

/** What one "recent sign-in" row carries: enough to judge it, never the raw audit metadata. */
export type SignInRecord = { at: string; success: boolean; ipAddress: string | null; userAgent: string | null; reason: string | null };

const MAX = 50;
/** Failure reasons the person may see (they explain a refusal of THEIR own attempt); anything else is shown as no reason. */
const SAFE_REASONS = new Set(['BAD_PASSWORD', 'ACCOUNT_LOCKED', 'ACCOUNT_DISABLED', 'EMAIL_VERIFICATION_REQUIRED', 'MFA_ENROLLMENT_REQUIRED']);

type Row = { createdAt: Date | string; action: string; ipAddress?: string | null; userAgent?: string | null; metadata?: unknown };

export function toSignInRecord(row: Row): SignInRecord {
  const reason = (row.metadata as { reason?: unknown } | null | undefined)?.reason;
  return {
    at: new Date(row.createdAt).toISOString(),
    success: row.action === 'auth.login',
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ? String(row.userAgent).slice(0, 200) : null,
    reason: row.action === 'auth.login' ? null : typeof reason === 'string' && SAFE_REASONS.has(reason) ? reason : null,
  };
}

/**
 * GET /tenant/[tenantId]/api/auth/me/sign-ins
 * "Recent sign-ins" (docs/phases/38-security 3.7): the signed-in person's OWN successful and failed sign-ins in this tenant, newest first (up to 50),
 * read from the audit log. The actor is always the session's user, never a query parameter, so nobody can read another person's history here. A revoked
 * or expired malicious session leaves no row in the sessions panel; it leaves one here.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user } = await authorizeRequest({ request, requiredPermission: 'account.sign_ins.read', scope: 'ACCOUNT' });
    const [ok, failed] = await Promise.all(['auth.login', 'auth.login_failed'].map((action) =>
      AuditLogService.getAll({ tenantId, actorId: user.userId, action, page: 1, pageSize: MAX })));
    const rows = [...ok.logs, ...failed.logs] as unknown as Row[];
    const signIns = rows
      .map(toSignInRecord)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, MAX);
    return NextResponse.json({ signIns });
  } catch (e) {
    return normalizeError(e);
  }
}
