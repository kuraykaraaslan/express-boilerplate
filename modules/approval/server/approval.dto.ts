import { z } from 'zod';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { ApprovalDecisionEnum, ApprovalStatusEnum } from './approval.enums';

/**
 * Request DTOs for the approval-queue routes. Mirrors the wallet module's DTO
 * conventions: trim/normalize at the boundary, cap free-text lengths, coerce
 * query params, and keep server-derived fields (the acting user) out of the
 * body schema (the route injects them after auth).
 */

export const SubmitApprovalDTO = z.object({
  // A free-form domain tag identifying the kind of entity under review. The
  // queue never interprets it beyond routing the registered decision handler.
  entityType: z.string().min(1).max(64),
  entityId: z.string().uuid(),
  // The user who submitted / triggered the item (notified on decision). Null
  // for system-flagged items.
  submittedByUserId: z.string().uuid().nullable().optional(),
  // Higher = more urgent; drives the SLA bucket.
  priority: z.coerce.number().int().min(0).max(3).default(0),
  reason: z.string().max(2000).optional(),
  // approval.07 (fixed 2026-10-20): bounded (64 KiB serialised); it is stored on the row, listed and re-sent in every webhook.
  metadata: z.record(z.string(), z.unknown()).refine((m) => JSON.stringify(m).length <= 64 * 1024, 'metadata is too large (64 KiB at most)').optional(),
});
export type SubmitApprovalDTO = z.infer<typeof SubmitApprovalDTO>;

export const DecideApprovalDTO = z.object({
  decision: ApprovalDecisionEnum,
  note: z.string().max(2000).optional(),
});
export type DecideApprovalDTO = z.infer<typeof DecideApprovalDTO>;

// PATCH body for an approval item — either a claim or a decision.
export const ApprovalActionDTO = z
  .object({
    action: z.enum(['claim', 'decide']),
    decision: ApprovalDecisionEnum.optional(),
    note: z.string().max(2000).optional(),
  })
  .refine((v) => v.action !== 'decide' || !!v.decision, {
    message: 'A decision is required when action is "decide"',
    path: ['decision'],
  });
export type ApprovalActionDTO = z.infer<typeof ApprovalActionDTO>;

// Query params for the approval reports endpoint (inclusive date range).
export const ApprovalReportQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ApprovalReportQuery = z.infer<typeof ApprovalReportQuery>;

export const APPROVAL_SORTABLE = {
  priority: 'priority', status: 'status', entityType: 'entityType', slaDueAt: 'slaDueAt', reviewedAt: 'reviewedAt', createdAt: 'createdAt',
} as const;

/** Phase 43 list contract. `status` and `priority` take one value or a comma list (`priority=2,3`). */
export const ListApprovalsQuery = listQuerySchema({
  sortable: APPROVAL_SORTABLE,
  defaultSort: 'priority:desc',
  filters: {
    status: listFilter.oneOf(ApprovalStatusEnum.options),
    entityType: z.string().max(64).optional(),
    entityId: z.string().uuid().optional(),
    reviewedByUserId: z.string().uuid().optional(),
    priority: z
      .string()
      .regex(/^[0-3](,[0-3])*$/, 'Use priorities 0-3, comma separated')
      .transform((v) => v.split(',').map(Number))
      .optional(),
  },
});
export type ListApprovalsQuery = z.infer<typeof ListApprovalsQuery>;

/** What the queue's list takes: the parsed query, or a service caller's literal (one status, one priority, no sort). */
export type ApprovalListInput = Omit<ListApprovalsQuery, 'sort' | 'status' | 'priority' | 'search'> & {
  sort?: ListApprovalsQuery['sort'];
  search?: string;
  status?: z.infer<typeof ApprovalStatusEnum> | z.infer<typeof ApprovalStatusEnum>[];
  priority?: number | number[];
};
