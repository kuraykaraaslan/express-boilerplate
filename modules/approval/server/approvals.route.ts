import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { ApprovalQueueService, ListApprovalsQuery, SubmitApprovalDTO } from '@kuraykaraaslan-labs/approval';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { getPriorityLabels } from '@kuraykaraaslan-labs/approval/server/approval.priority-labels';
import { SETTING_CHANGE_ENTITY_TYPE } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.write.maker-checker';

/**
 * GET /tenant/[tenantId]/api/approvals
 * List moderation / approval queue items (admin).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'approval.approvals.read', scope: 'TENANT' });

    const query = readListQuery(new URL(request.url).searchParams, ListApprovalsQuery);
    const [list, priorityLabels] = await Promise.all([ApprovalQueueService.list(tenantId, query), getPriorityLabels(tenantId)]);
    return NextResponse.json({ ...list, priorityLabels }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/approvals
 * Submit an entity to the approval queue (admin). Idempotent per open entity.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'approval.approvals.submit', scope: 'TENANT' });

    const body = (await request.json()) as Record<string, unknown>;
    const parsed = SubmitApprovalDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }
    // A parked setting change is applied as-is on approval, so only the settings write path (maker-checker) may create
    // one: from here it would skip every check of the settings routes.
    if (parsed.data.entityType === SETTING_CHANGE_ENTITY_TYPE) {
      return NextResponse.json({ message: 'Setting changes are submitted through the settings routes' }, { status: 403 });
    }
    // The same for every type an owning module claims (F.approval.01, fixed 2026-10-20): its handler acts on the item's
    // metadata when the item is approved (a member role change, a journal entry, an erasure...), so only the owner's own
    // write path may create one. Through this route an attacker chose that metadata.
    if (await ApprovalQueueService.isOwnedEntityType(parsed.data.entityType)) {
      return NextResponse.json({ message: 'This item type is submitted through its own module' }, { status: 403 });
    }
    // The submitter is always the caller (approval.01, fixed 2026-10-20): a body value is validated, then overwritten.
    return NextResponse.json({ item: await ApprovalQueueService.submit(tenantId, { ...parsed.data, submittedByUserId: user.userId }) }, { status: 201 });
  } catch (e) {
    return normalizeError(e);
  }
}
