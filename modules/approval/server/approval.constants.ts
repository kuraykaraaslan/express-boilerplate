import { chainedRowHashV2, matchChainedRow } from '@kuraykaraaslan-labs/common/server/common.hash-chain';

/**
 * Approval-queue constants: the tamper-evident hash-chain helper (copied from
 * the audit_log / wallet canonical hashing so decision records verify the same
 * way) and the SLA-by-priority map.
 */

/**
 * Immutable insert-time content hashed into the per-tenant approval chain. Only
 * fields that never change after submit participate, so the chain is genuinely
 * append-only (like audit_log / wallet) and is not invalidated by later claim /
 * decide mutations. The decision audit trail itself is the append-only
 * `audit_log` (written on every decision via `AuditLogService.log`).
 */
export interface ApprovalHashRow {
  approvalItemId: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  submittedByUserId: string | null;
  priority: number;
  reason: string | null;
  createdAt: Date;
}

/** The insert-time content of a row, in the order the chain has always hashed it (that order is part of every stored hash). */
export function approvalRowContent(row: ApprovalHashRow): Record<string, unknown> {
  return {
    approvalItemId: row.approvalItemId,
    tenantId: row.tenantId,
    entityType: row.entityType,
    entityId: row.entityId,
    submittedByUserId: row.submittedByUserId,
    priority: row.priority,
    reason: row.reason,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/**
 * The row hash new items are written with: the KEYED v2 chain of `common.hash-chain` (approval.06, 2026-10-20). v1 rows
 * (the unkeyed sha256 written before the cutover) still verify through `matchApprovalRow`; nothing is re-hashed.
 * `prevHash` is the previous approval item's rowHash for the SAME tenant (null for the first row).
 */
export function computeRowHash(prevHash: string | null, row: ApprovalHashRow): string {
  return chainedRowHashV2(prevHash, approvalRowContent(row));
}

/** Which chain version produced `stored` for this row: 2, 1, or null when the row was altered. */
export function matchApprovalRow(prevHash: string | null, row: ApprovalHashRow, stored: string | null | undefined): 2 | 1 | null {
  return matchChainedRow(prevHash, approvalRowContent(row), stored);
}

/** The mutable decision state of an item, which the row hash does not cover. */
export interface ApprovalDecisionState {
  rowHash: string | null;
  status?: string | null;
  reviewedByUserId?: string | null;
  decisionNote?: string | null;
  reviewedAt?: Date | string | null;
}

/**
 * The decision seal (approval.06, 2026-10-20). The row hash covers only insert-time content, so the decision (status,
 * reviewer, note, time) used to be editable after the fact with `verifyChain` still green. Every write of a decision now
 * re-seals it: a keyed HMAC over the row's own `rowHash` plus the decision state, so the seal is bound to that row and
 * cannot be recomputed without the server key. `verifyChain` checks it on every row that carries one, and requires it on
 * every v2 row.
 */
export function computeDecisionHash(row: ApprovalDecisionState): string {
  const at = row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : (row.reviewedAt ?? null);
  return chainedRowHashV2(row.rowHash ?? null, {
    status: row.status ?? null,
    reviewedByUserId: row.reviewedByUserId ?? null,
    decisionNote: row.decisionNote ?? null,
    reviewedAt: at,
  });
}

/** The keyed seal of a tenant's chain head row (approval.08): the anchor cannot be rewritten to fit a truncated chain without the key. */
export function approvalHeadSeal(tenantId: string, headHash: string, length: number): string {
  return chainedRowHashV2(null, { approval_chain_head: tenantId, headHash, length });
}

/** Re-seal the decision state in place. Call it on every write that changes status, reviewer, note or reviewedAt. */
export function sealDecision<T extends ApprovalDecisionState & { decisionHash?: string | null }>(row: T): T {
  row.decisionHash = computeDecisionHash(row);
  return row;
}

/**
 * SLA target (hours-to-first-resolution) per approval priority bucket. A higher
 * numeric `priority` is more urgent; `slaDueAt` is computed as
 * `now + APPROVAL_SLA_HOURS[bucket]`. Unmapped priorities fall back to the
 * default bucket.
 */
export const APPROVAL_SLA_HOURS: Readonly<Record<number, number>> = {
  0: 72, // routine
  1: 48, // elevated
  2: 24, // high
  3: 8, // urgent
} as const;

/** Default SLA window (hours) for an approval priority not present in the map. */
export const APPROVAL_DEFAULT_SLA_HOURS = 72;

/** Per-priority SLA-hours map (may be resolved from per-tenant settings). */
export type ApprovalSlaHoursMap = Readonly<Record<number, number>>;

/**
 * Resolve the SLA due-date for an approval item given its (clamped) priority.
 * An optional `hoursMap` overrides the hardcoded APPROVAL_SLA_HOURS buckets
 * (resolved from per-tenant SettingService config in the submit service). Since
 * `slaDueAt` is NOT part of the tamper-evident hash chain, recomputing it from
 * tenant config is chain-safe.
 */
export function approvalSlaDueAt(
  priority: number,
  from: Date = new Date(),
  hoursMap: ApprovalSlaHoursMap = APPROVAL_SLA_HOURS,
): Date {
  const hours = hoursMap[priority] ?? APPROVAL_SLA_HOURS[priority] ?? APPROVAL_DEFAULT_SLA_HOURS;
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}
