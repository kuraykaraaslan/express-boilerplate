import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { ApprovalQueueService, ApprovalReportQuery } from '@kuraykaraaslan-labs/approval';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/approvals/reports?from=&to=
 * Period-based approval analytics: SLA compliance, approver workload,
 * entity-type breakdown and daily trend (admin).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'approval.reports.read', scope: 'TENANT' });

    const { searchParams } = new URL(request.url);
    const parsed = ApprovalReportQuery.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      await ApprovalQueueService.getReport(tenantId, { from: parsed.data.from, to: parsed.data.to }),
      { status: 200 },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
