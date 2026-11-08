import 'reflect-metadata';
import type { ApprovalChainVerificationResult, ApprovalDecider, ApprovalDecisionGuard, ApprovalDecisionHandler, ApprovalQueueItem } from './approval.types';
import type { DecideApprovalDTO, ApprovalListInput, SubmitApprovalDTO } from './approval.dto';
import { registerHandler, unregisterHandler, registerDecisionGuard, unregisterDecisionGuard, isOwnedEntityType } from './approval.handlers';
import { verifyChain } from './approval.chain';
import { list, get } from './approval.read.service';
import { submit, claim } from './approval.submit.service';
import { decide } from './approval.decide.service';
import { withdrawForEntity } from './approval.withdraw.service';
import ApprovalReportService, { type ApprovalReport } from './approval.report.service';

/**
 * Approval-queue service facade. The implementation is split across focused
 * modules (`approval.handlers`, `.chain`, `.read.service`,
 * `.submit.service`, `.decide.service`); this class preserves the single
 * `ApprovalQueueService.*` entry point its callers depend on.
 */
export default class ApprovalQueueService {
  static registerHandler(entityType: string, handler: ApprovalDecisionHandler): void {
    registerHandler(entityType, handler);
  }

  static unregisterHandler(entityType: string): void {
    unregisterHandler(entityType);
  }

  /** Whether an owning module claims `entityType` (a handler or an approve guard is registered for it). */
  static isOwnedEntityType(entityType: string): Promise<boolean> {
    return isOwnedEntityType(entityType);
  }

  /** Refuse a bare APPROVE of an `entityType` whose owner needs more than a click (see `approval.handlers`). */
  static registerDecisionGuard(entityType: string, guard: ApprovalDecisionGuard): void {
    registerDecisionGuard(entityType, guard);
  }

  static unregisterDecisionGuard(entityType: string): void {
    unregisterDecisionGuard(entityType);
  }

  static submit(tenantId: string, dto: SubmitApprovalDTO): Promise<ApprovalQueueItem> {
    return submit(tenantId, dto);
  }

  static list(tenantId: string, query: ApprovalListInput): Promise<{ data: ApprovalQueueItem[]; total: number }> {
    return list(tenantId, query);
  }

  static get(tenantId: string, approvalItemId: string): Promise<ApprovalQueueItem> {
    return get(tenantId, approvalItemId);
  }

  /** Close an entity's open item as WITHDRAWN (the owner settled it elsewhere). Idempotent; null when none is open. */
  static withdrawForEntity(
    tenantId: string, entityType: string, entityId: string, opts: { actorId?: string | null; reason?: string } = {},
  ): Promise<ApprovalQueueItem | null> {
    return withdrawForEntity(tenantId, entityType, entityId, opts);
  }

  static claim(tenantId: string, reviewerUserId: string, approvalItemId: string): Promise<ApprovalQueueItem> {
    return claim(tenantId, reviewerUserId, approvalItemId);
  }

  static decide(
    tenantId: string, reviewerUserId: string, approvalItemId: string, dto: DecideApprovalDTO, decider?: ApprovalDecider,
  ): Promise<ApprovalQueueItem> {
    return decide(tenantId, reviewerUserId, approvalItemId, dto, decider);
  }

  static verifyChain(tenantId: string): Promise<ApprovalChainVerificationResult> {
    return verifyChain(tenantId);
  }

  static getReport(tenantId: string, opts: { from?: Date; to?: Date } = {}): Promise<ApprovalReport> {
    return ApprovalReportService.getReport(tenantId, opts);
  }
}
