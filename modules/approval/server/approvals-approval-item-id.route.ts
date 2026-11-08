import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { ApprovalQueueService, ApprovalActionDTO } from '@kuraykaraaslan-labs/approval';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { getPriorityLabels } from '@kuraykaraaslan-labs/approval/server/approval.priority-labels';

/**
 * GET /tenant/[tenantId]/api/approvals/[approvalItemId]
 * Fetch a single approval item (admin).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; approvalItemId: string }> },
) {
  try {
    const { tenantId, approvalItemId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'approval.approvals.read', scope: 'TENANT' });
    const [item, priorityLabels] = await Promise.all([ApprovalQueueService.get(tenantId, approvalItemId), getPriorityLabels(tenantId)]);
    return NextResponse.json({ item, priorityLabels }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PATCH /tenant/[tenantId]/api/approvals/[approvalItemId]
 * Claim a pending item or record a decision (approve / reject / escalate) (admin).
 * Body: { action: 'claim' } | { action: 'decide', decision, note? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; approvalItemId: string }> },
) {
  try {
    const { tenantId, approvalItemId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'approval.approvals.decide', scope: 'TENANT' });
    const { user } = auth;

    const parsed = ApprovalActionDTO.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }

    if (parsed.data.action === 'claim') {
      const item = await ApprovalQueueService.claim(tenantId, user.userId, approvalItemId);
      return NextResponse.json({ item }, { status: 200 });
    }

    const item = await ApprovalQueueService.decide(tenantId, user.userId, approvalItemId, {
      decision: parsed.data.decision!,
      note: parsed.data.note,
    }, {
      // The decision's APPROVE guard may depend on the approver's address (a parked IP list change must keep its approver).
      request,
      ipListsExempt: 'ipListsExempt' in auth && auth.ipListsExempt === true,
    });
    return NextResponse.json({ item }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
