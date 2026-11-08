import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ApprovalQueueItem as ApprovalQueueItemEntity } from './entities/approval_queue_item.entity';
import { ApprovalQueueItemSchema, type ApprovalQueueItem } from './approval.types';
import { compactWhere, inList, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { APPROVAL_SORTABLE, type ApprovalListInput } from './approval.dto';
import { APPROVAL_MESSAGES as MSG } from './approval.messages';

export async function list(
  tenantId: string,
  query: ApprovalListInput,
): Promise<{ data: ApprovalQueueItem[]; total: number }> {
  const where = compactWhere({
    tenantId,
    status: inList(query.status),
    entityType: query.entityType || undefined,
    entityId: query.entityId || undefined,
    reviewedByUserId: query.reviewedByUserId || undefined,
    priority: inList(query.priority),
  });
  const [rows, total] = await withTenantRepositoryFor(tenantId, ApprovalQueueItemEntity, (repo) => repo.findAndCount({
    where: searchWhere(where, query.search, ['entityType', 'reason']),
    // Most urgent first, then oldest — a sensible work queue order.
    order: toOrder(query.sort ?? [{ field: 'priority', dir: 'desc' }], APPROVAL_SORTABLE, { createdAt: 'ASC', approvalItemId: 'ASC' }, ApprovalQueueItemEntity),
    skip: query.page * query.pageSize,
    take: query.pageSize,
  }));
  return { data: rows.map((r) => ApprovalQueueItemSchema.parse(r)), total };
}

export async function get(tenantId: string, approvalItemId: string): Promise<ApprovalQueueItem> {
  const row = await withTenantRepositoryFor(tenantId, ApprovalQueueItemEntity, (repo) => repo.findOne({
    where: { tenantId, approvalItemId },
  }));
  if (!row) throw new AppError(MSG.APPROVAL_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return ApprovalQueueItemSchema.parse(row);
}
