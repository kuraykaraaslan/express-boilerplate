import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ApprovalChainService from '@kuraykaraaslan-labs/approval/server/approval.chain-steps.service';

/** GET …/api/approvals/steps/mine — approval-chain steps waiting on the caller by name (a manager's queue), `{ data, total }`. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'approval.steps.decide', scope: 'TENANT' });
    return NextResponse.json(await ApprovalChainService.pendingFor(tenantId, user.userId));
  } catch (e) {
    return normalizeError(e);
  }
}
