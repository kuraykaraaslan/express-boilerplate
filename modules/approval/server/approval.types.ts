import { z } from 'zod';
import { ApprovalStatusEnum } from './approval.enums';

/**
 * Parsed/serialized shapes for approval-queue rows. These mirror the entity but
 * normalize dates and guarantee `JSON.stringify`-safe output, exactly like the
 * wallet module's `*.types.ts`.
 */

export const ApprovalQueueItemSchema = z.object({
  approvalItemId: z.string().uuid(),
  tenantId: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  submittedByUserId: z.string().uuid().nullable(),
  status: ApprovalStatusEnum,
  priority: z.number().int(),
  reason: z.string().nullable(),
  decisionNote: z.string().nullable(),
  reviewedByUserId: z.string().uuid().nullable(),
  reviewedAt: z.date().nullable(),
  slaDueAt: z.date().nullable(),
  prevHash: z.string().nullable(),
  rowHash: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type ApprovalQueueItem = z.infer<typeof ApprovalQueueItemSchema>;

/** Result of re-deriving the per-tenant approval decision hash chain. */
export interface ApprovalChainVerificationResult {
  ok: boolean;
  checked: number;
  brokenAt: string | null;
}

/**
 * In-memory hook a downstream module registers so it can react to a terminal
 * approval decision (e.g. publish the approved entity). It is fire-and-forget:
 * a thrown/ rejected handler is logged and swallowed so it can never break the
 * decision write.
 */
export type ApprovalDecisionHandler = (event: {
  tenantId: string;
  item: ApprovalQueueItem;
}) => void | Promise<void>;

/**
 * The request that records a decision, for a guard whose check depends on who decides from where (e.g. the tenant IP
 * lists, which must keep their approver). Absent when a system flow decides.
 */
export interface ApprovalDecider {
  request: { headers: Pick<Headers, 'get'> };
  /** The tenant IP allow/deny lists do not apply to the decider (`TenantAuthResult.ipListsExempt`). */
  ipListsExempt?: boolean;
}

/**
 * A pre-decision check for APPROVE (see `registerDecisionGuard`). Throws to refuse the decision; resolves to allow it.
 */
export type ApprovalDecisionGuard = (event: {
  tenantId: string;
  item: ApprovalQueueItem;
  decider?: ApprovalDecider;
  /** The reviewer recording the APPROVE (absent only when a caller does not say), e.g. to refuse a four-eyes self-approval. */
  reviewerUserId?: string;
}) => void | Promise<void>;
