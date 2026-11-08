// path: app/tenant/[tenantId]/api/members/[memberId]/activity/route.ts
import { NextRequest, NextResponse } from "next/server";
import TenantMemberService from "@kuraykaraaslan-labs/tenant_member/server/tenant_member.service";
import AuditLogService from "@kuraykaraaslan-labs/audit_log/server/audit_log.service";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AuditSeverityEnum } from "@kuraykaraaslan-labs/audit_log/server/audit_log.enums";

type Params = { params: Promise<{ tenantId: string; memberId: string }> };

/**
 * GET /tenant/[tenantId]/api/members/[memberId]/activity
 * Activity timeline for a member — reads the tenant's audit log filtered to the
 * member's userId (actorId). Read-only cross-module integration with audit_log.
 * Requires ADMIN role. Query params: page, pageSize, action, severity.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, memberId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'members.view_activity', scope: 'TENANT' });

    // Resolve the member's userId — audit rows are keyed by actorId (= userId).
    const member = await TenantMemberService.getById(memberId, tenantId);

    const { searchParams } = new URL(request.url);
    // tenant_member.13 (fixed 2026-10-20): page / pageSize are clamped and the severity is one of the audit_log values (else 400),
    // before anything reaches the audit query.
    const severity = searchParams.get("severity") ?? undefined;
    if (severity !== undefined && !AuditSeverityEnum.safeParse(severity).success) {
      return NextResponse.json({ message: "Unknown severity" }, { status: 400 });
    }
    const int = (raw: string | null, fallback: number, max: number) => {
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback;
    };
    const { logs, total } = await AuditLogService.getAll({
      tenantId,
      actorId: member.userId,
      action: searchParams.get("action") ?? undefined,
      severity: severity as never,
      page: int(searchParams.get("page"), 1, 100_000),
      pageSize: int(searchParams.get("pageSize"), 20, 200),
    });

    return NextResponse.json({ logs, total }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
