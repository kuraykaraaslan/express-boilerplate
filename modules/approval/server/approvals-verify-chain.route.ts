import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { ApprovalQueueService } from '@kuraykaraaslan-labs/approval';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/approvals/verify-chain
 * Re-derive the per-tenant approval decision hash chain (admin).
 * Returns { ok, checked, brokenAt }.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'approval.approvals.verify', scope: 'TENANT' });
    return NextResponse.json(await ApprovalQueueService.verifyChain(tenantId), { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
