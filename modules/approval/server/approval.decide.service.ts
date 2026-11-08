import 'reflect-metadata';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import NotificationInAppService from '@kuraykaraaslan-labs/notification_inapp/server/notification_inapp.service';
import { ApprovalQueueItem as ApprovalQueueItemEntity } from './entities/approval_queue_item.entity';
import { ApprovalChainStep } from './entities/approval_chain_step.entity';
import { ApprovalQueueItemSchema, type ApprovalDecider, type ApprovalQueueItem } from './approval.types';
import type { DecideApprovalDTO } from './approval.dto';
import { APPROVAL_MESSAGES as MSG } from './approval.messages';
import { DECISION_TO_STATUS, TERMINAL_APPROVAL_STATUSES, type ApprovalStatus } from './approval.enums';
import { onDecision, checkApproveGuard, ensureApprovalHandlers } from './approval.handlers';
import { sealDecision } from './approval.constants';

/** `CHAIN_STEP_ENTITY_TYPE` of approval.chain-steps.service, repeated here because that module imports this one. */
const CHAIN_STEP_ITEM_TYPE = 'approval_chain_step';

/**
 * Record a reviewer decision. Allowed transitions:
 *  - APPROVE / REJECT (terminal) from PENDING | IN_REVIEW | ESCALATED
 *  - ESCALATE (stays open) from PENDING | IN_REVIEW
 * Already-terminal items are rejected with CONFLICT.
 *
 * On a terminal decision the per-tenant audit log is written, the registered
 * decision handler is invoked, the submitter is notified (fire-and-forget) —
 * in-app and by email — and a `approval.<approved|rejected|escalated>` webhook
 * fires.
 *
 * `decider`: the reviewer's request (and IP list exemption), handed to the entityType's APPROVE guard; a route deciding
 * for a signed-in reviewer passes it, a system flow does not.
 */
export async function decide(
  tenantId: string,
  reviewerUserId: string,
  approvalItemId: string,
  dto: DecideApprovalDTO,
  decider?: ApprovalDecider,
): Promise<ApprovalQueueItem> {
  const newStatus = DECISION_TO_STATUS[dto.decision];
  // The guard and the handler need the owners' registrars to have run in this bundle's copy of approval.handlers. The first
  // decision loads them here, before the row lock is taken, so a cold module import never stretches the locked transaction.
  await ensureApprovalHandlers();
  try {
    // The locked read-check-write is one tenant-scoped transaction; the audit,
    // decision handler, notification and webhook below all run after commit.
    const row = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(ApprovalQueueItemEntity);
      const item = await repo.findOne({
        where: { tenantId, approvalItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new AppError(MSG.APPROVAL_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

      // Guard the transition: terminal items are immutable; ESCALATE only
      // from a still-actionable (not already escalated) open state.
      if (TERMINAL_APPROVAL_STATUSES.includes(item.status as ApprovalStatus)) {
        throw new AppError(MSG.ALREADY_DECIDED, 409, ErrorCode.CONFLICT);
      }
      if (dto.decision === 'ESCALATE' && item.status === 'ESCALATED') {
        throw new AppError(MSG.INVALID_TRANSITION, 409, ErrorCode.CONFLICT);
      }

      // Nobody decides their own submission (approval.03, fixed 2026-10-20): not APPROVE, not REJECT, not ESCALATE. A chain
      // step's queue item carries no submitter of its own, so the chain's submitter is looked up: the chain's own-request
      // rule (STEP_OWN_REQUEST) used to be skipped by deciding the step's item through the queue PATCH.
      if (item.submittedByUserId && item.submittedByUserId === reviewerUserId) {
        throw new AppError(MSG.SELF_DECISION, 403, ErrorCode.FORBIDDEN);
      }
      if (item.entityType === CHAIN_STEP_ITEM_TYPE) {
        const step = await qr.manager.getRepository(ApprovalChainStep).findOne({ where: { tenantId, stepId: item.entityId } });
        if (step?.submittedByUserId && step.submittedByUserId === reviewerUserId) {
          throw new AppError(MSG.STEP_OWN_REQUEST, 403, ErrorCode.FORBIDDEN);
        }
      }

      // An owner that cannot honour a bare APPROVE (e.g. a command that needs every co-signature first) says so before anything is written.
      if (dto.decision === 'APPROVE') await checkApproveGuard(tenantId, item.entityType, () => ApprovalQueueItemSchema.parse(item), decider, reviewerUserId);

      item.status = newStatus;
      item.reviewedByUserId = reviewerUserId;
      item.decisionNote = dto.note ?? item.decisionNote ?? null;
      // reviewedAt marks when the decision was taken (terminal or escalation).
      item.reviewedAt = new Date();
      // approval.06: the decision is sealed into the chain (keyed), so an after-the-fact edit of it fails verifyChain.
      sealDecision(item);
      return repo.save(item);
    });

    const item = ApprovalQueueItemSchema.parse(row);
    const isTerminal = newStatus === 'APPROVED' || newStatus === 'REJECTED';

    // Audit every decision (approve / reject / escalate). Never throws.
    void AuditLogService.log({
      tenantId,
      actorId: reviewerUserId,
      actorType: 'USER',
      action: `approval.${dto.decision.toLowerCase()}`,
      resourceType: item.entityType,
      resourceId: item.entityId,
      metadata: {
        approvalItemId: item.approvalItemId,
        decision: dto.decision,
        note: dto.note ?? null,
        rowHash: item.rowHash,
      },
    });

    // Let the owning module react to terminal decisions.
    if (isTerminal) onDecision(tenantId, item);

    // Notify the submitter (fire-and-forget) if known. A TERMINAL decision goes
    // through the dispatcher, which writes the in-app copy AND sends the mail in
    // one call — pushing in-app here as well would post their inbox twice. A
    // non-terminal decision (an escalation) has no mail of its own, so it stays a
    // direct in-app push.
    if (item.submittedByUserId) {
      if (isTerminal) {
        void notifySubmitterDecision(tenantId, item.submittedByUserId, item);
      } else {
        void NotificationInAppService.push(tenantId, item.submittedByUserId, {
          title: `Your submission was ${newStatus.toLowerCase()}`,
          message:
            dto.note ??
            `Your ${item.entityType} submission has been ${newStatus.toLowerCase()}.`,
          type: 'approval',
        }).catch((err) =>
          Logger.error(`[approval] notify submitter failed: ${err}`),
        );
      }
    }

    const event =
      dto.decision === 'APPROVE'
        ? 'approval.approved'
        : dto.decision === 'REJECT'
          ? 'approval.rejected'
          : 'approval.escalated';
    void WebhookService.dispatchEvent(tenantId, event, {
      approvalItemId: item.approvalItemId,
      entityType: item.entityType,
      entityId: item.entityId,
      status: item.status,
      reviewedByUserId: reviewerUserId,
    }).catch((err) => Logger.error(`[approval] webhook dispatch failed: ${err}`));

    return item;
  } catch (error) {
    if (!(error instanceof AppError)) Logger.error(`${MSG.DECIDE_FAILED}: ${error}`);
    throw error;
  }
}

/**
 * Notify the submitter that their queued item reached a terminal decision
 * (APPROVED / REJECTED), best-effort, on every channel they allow — this single
 * call replaces the old "in-app push here, mail there" pair.
 *
 * The submitter's address is resolved via the user module; both that lookup and
 * the dispatcher are pulled in through dynamic `import()` so a decision write
 * only loads them when an item actually terminates. Any failure (unknown user,
 * no email, provider error) is logged and swallowed so a notification can never
 * roll back or 500 the decision. Deduped on the item + terminal status, which is
 * immutable.
 */
async function notifySubmitterDecision(
  tenantId: string,
  submittedByUserId: string,
  item: ApprovalQueueItem,
): Promise<void> {
  try {
    const { default: UserService } = await import('@kuraykaraaslan-labs/user/server/user.service');
    const user = await UserService.getById(submittedByUserId).catch(() => null);
    const email = (user as { email?: string } | null)?.email;
    if (!email) return;

    const verb = item.status.toLowerCase();
    const subject = `Your ${item.entityType} submission was ${verb}`;
    // approval.04 (fixed 2026-10-20): the submitter-chosen entityType and the reviewer's note are entity-escaped in the html.
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const html =
      `<p>Your <strong>${esc(item.entityType)}</strong> submission has been <strong>${verb}</strong>.</p>` +
      (item.decisionNote ? `<p>${esc(item.decisionNote)}</p>` : '');

    // PLAT-01: through the DISPATCHER, not the mail queue. The submitter is a
    // known member, so passing their `userId` alongside the address is what makes
    // their preferences apply and puts the decision in their in-app inbox.
    // NORMAL: a decision on your own submission is workspace traffic — important,
    // but not something a preference must be forbidden from holding.
    const { default: NotificationService } = await import(
      '@kuraykaraaslan-labs/notification/server/notification.service'
    );
    await NotificationService.notify(
      tenantId,
      { userId: submittedByUserId, email },
      { event: 'approval.decided', category: 'workspace', title: subject, body: subject, data: { html } },
      { urgency: 'NORMAL', idempotencyKey: `approval:decision:${item.approvalItemId}:${item.status}` },
    );
  } catch (err) {
    Logger.warn(
      `[approval] email submitter failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
