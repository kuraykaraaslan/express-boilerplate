import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import Logger from '@kuraykaraaslan-labs/logger';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { evaluatePermissionFromRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.pdp.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import ApprovalChainService from '@kuraykaraaslan-labs/approval/server/approval.chain-steps.service';

const DecideStepDTO = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).optional() });

/** Fails closed: a PDP error means "no". */
async function permits(request: NextRequest, tenantId: string, permission: string): Promise<boolean> {
  try {
    return (await evaluatePermissionFromRequest({ request, tenantId, requiredPermission: permission })).effect === 'permit';
  } catch (error) {
    Logger.warn(`[approval.steps] permission check failed tenant=${tenantId} ${permission}: ${error}`);
    return false;
  }
}

/**
 * POST …/api/approvals/steps/[stepId]/decide { decision, note? } — decide the
 * active step of a chain. The named approver may; so may a caller holding
 * the step's permission or the queue's `approval.approvals.decide`.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; stepId: string }> }) {
  try {
    const { tenantId, stepId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'approval.steps.decide', scope: 'TENANT' });
    const { user } = auth;
    const dto = DecideStepDTO.parse(await request.json());
    const step = await ApprovalChainService.getStep(tenantId, stepId);
    // The queue-wide decide right carries its catalog floor (ADMIN) on top of the PDP, like the route guard applies a floor
    // (approval.05, fixed 2026-10-20): the PDP permits a permission an unseeded tenant's matrix has no row for, which let
    // every USER-floor `approval.steps.decide` holder decide every chain's steps.
    const role = auth.tenantMember?.memberRole;
    const queueDecider = (role === 'ADMIN' || role === 'OWNER') && await permits(request, tenantId, 'approval.approvals.decide');
    const mayDecideAny = queueDecider
      || (!!step.approverPermission && await permits(request, tenantId, step.approverPermission));
    const saved = await ApprovalChainService.decide(tenantId, stepId, user.userId, dto.decision, {
      note: dto.note, mayDecideAny,
      // The decision's APPROVE guard may depend on the approver's address (a parked IP list change must keep its approver).
      decider: { request, ipListsExempt: 'ipListsExempt' in auth && auth.ipListsExempt === true },
    });
    return NextResponse.json({ step: saved });
  } catch (e) {
    return normalizeError(e);
  }
}
