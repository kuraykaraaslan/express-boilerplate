import 'reflect-metadata';
import { In } from 'typeorm';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { ApprovalQueueItem as ApprovalQueueItemEntity } from './entities/approval_queue_item.entity';
import { ApprovalQueueItemSchema, type ApprovalQueueItem } from './approval.types';
import { OPEN_APPROVAL_STATUSES } from './approval.enums';
import { sealDecision } from './approval.constants';

/**
 * Close an entity's OPEN queue item because its owning module settled it
 * another way (decided on its own page, withdrawn by the requester, deleted).
 *
 * - **Not a reviewer decision.** The status becomes WITHDRAWN. The owner's
 *   decision handler is NOT called: the owner is the caller, and calling it
 *   back would loop. The submitter is not notified; the owner already tells
 *   them what happened. Decision reports (SLA, workload) do not count it.
 * - **Idempotent.** No open item returns null. It is therefore safe to call
 *   from every terminal path, including the one the queue's own decision
 *   triggers (that item is already APPROVED/REJECTED).
 * - **Locked.** The open item is read with a row lock, so a reviewer's
 *   concurrent decide either lands first (and this is a no-op) or waits and
 *   then gets 409 ALREADY_DECIDED.
 *
 * The audit entry and webhook run after the commit.
 */
export async function withdrawForEntity(
  tenantId: string,
  entityType: string,
  entityId: string,
  opts: { actorId?: string | null; reason?: string } = {},
): Promise<ApprovalQueueItem | null> {
  const row = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(ApprovalQueueItemEntity);
    const item = await repo.findOne({
      where: { tenantId, entityType, entityId, status: In([...OPEN_APPROVAL_STATUSES]) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) return null;
    item.status = 'WITHDRAWN';
    item.reviewedAt = new Date();
    item.decisionNote = opts.reason?.slice(0, 2000) ?? item.decisionNote ?? null;
    return repo.save(sealDecision(item)); // approval.06: the withdrawal is sealed like any decision
  });
  if (!row) return null;
  const item = ApprovalQueueItemSchema.parse(row);

  void AuditLogService.log({
    tenantId,
    actorId: opts.actorId ?? null,
    actorType: opts.actorId ? 'USER' : 'SYSTEM',
    action: 'approval.withdrawn',
    resourceType: item.entityType,
    resourceId: item.entityId,
    metadata: { approvalItemId: item.approvalItemId, reason: opts.reason ?? null, rowHash: item.rowHash },
  });
  void WebhookService.dispatchEvent(tenantId, 'approval.withdrawn', {
    approvalItemId: item.approvalItemId,
    entityType: item.entityType,
    entityId: item.entityId,
    status: item.status,
  }).catch((err) => Logger.error(`[approval] webhook dispatch failed: ${err}`));
  return item;
}
