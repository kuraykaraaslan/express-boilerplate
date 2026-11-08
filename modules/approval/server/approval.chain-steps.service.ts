import 'reflect-metadata';
import { In } from 'typeorm';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ApprovalChainStep } from './entities/approval_chain_step.entity';
import type { ApprovalDecider, ApprovalQueueItem } from './approval.types';
import { APPROVAL_MESSAGES as MSG } from './approval.messages';
import { registerHandler, ensureApprovalHandlers } from './approval.handlers';
import { submit } from './approval.submit.service';
import { decide } from './approval.decide.service';
import { withdrawForEntity } from './approval.withdraw.service';

/**
 * Multi-step approval chains (migration 173) — the polymorphic primitive the
 * 2026-09-11 alignment note moved out of hr_leave's `leave_approval_steps`.
 *
 * - **The owner defines the chain; `approval` runs it.** `start` takes the
 *   ordered steps (level, named approver or permission) for an
 *   `(entityType, entityId, purpose)`. The first step is PENDING, the rest
 *   WAITING.
 * - **The active step is an ordinary queue item** (`approval_chain_step`),
 *   so it shows in the queue, is audited and hash-chained like any other.
 *   `approval_queue_items` is not changed.
 * - **A decision advances the chain.** APPROVED: the next step becomes
 *   PENDING, or, at the end, the owner's completion callback runs with
 *   APPROVED. REJECTED: the remaining steps are SKIPPED and the owner hears
 *   REJECTED. Idempotent: only a PENDING step moves.
 * - **Who may decide a step** through `decide`: its named approver, or a
 *   caller the route says may act for anyone (the step's permission, or the
 *   queue's own `approval.approvals.decide`). A queue reviewer can, as for any
 *   item, decide it from the queue.
 * - **The owner settling the entity another way** (a direct decision, a
 *   withdrawal) calls `cancel`: open steps become CANCELLED and the active
 *   queue item WITHDRAWN.
 * - Owners register a completion callback with `registerOwner`, at boot, in
 *   the process that runs decisions — the same wiring as `registerHandler`.
 */

export const CHAIN_STEP_ENTITY_TYPE = 'approval_chain_step';
const OPEN = ['WAITING', 'PENDING'];
/** Most steps the "my approvals" inbox reads at once; past it the page says how many more wait. */
const MY_STEPS_MAX = 1000;

export interface ChainStepSpec {
  level: string;
  approverUserId?: string | null;
  approverPermission?: string | null;
}

export interface ChainCompletion {
  tenantId: string;
  entityType: string;
  entityId: string;
  purpose: string;
  outcome: 'APPROVED' | 'REJECTED';
  decidedByUserId: string | null;
  note: string | null;
}
type OwnerCallbacks = {
  onComplete: (event: ChainCompletion) => void | Promise<void>;
  /** Told when a step becomes PENDING, e.g. to notify its named approver. */
  onStepActivated?: (event: { tenantId: string; step: ApprovalChainStep }) => void | Promise<void>;
};

const OWNERS = new Map<string, OwnerCallbacks>();

export default class ApprovalChainService {
  /** Register the owner of an entityType's chains (idempotent; replaces). */
  static registerOwner(entityType: string, callbacks: OwnerCallbacks): void {
    OWNERS.set(entityType, callbacks);
    registerHandler(CHAIN_STEP_ENTITY_TYPE, (e) => ApprovalChainService.onQueueDecision(e.tenantId, e.item));
  }

  /** Start a chain. An open chain for the same entity and purpose is returned as is. */
  static async start(tenantId: string, input: {
    entityType: string; entityId: string; purpose?: string; steps: ChainStepSpec[];
    submittedByUserId?: string | null; priority?: number; reason?: string | null; metadata?: Record<string, unknown> | null;
  }): Promise<ApprovalChainStep[]> {
    if (input.steps.length === 0) throw new AppError(MSG.CHAIN_EMPTY, 422, ErrorCode.VALIDATION_ERROR);
    const purpose = input.purpose ?? 'REQUEST';
    const priority = Math.min(3, Math.max(0, input.priority ?? 0));
    let created = false;
    const steps = await withTenantTransactionFor(tenantId, async (qr) => {
      await qr.manager.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`approval:chain:${tenantId}:${input.entityType}:${input.entityId}:${purpose}`]);
      const repo = qr.manager.getRepository(ApprovalChainStep);
      const open = await repo.find({ where: { tenantId, entityType: input.entityType, entityId: input.entityId, purpose, status: In(OPEN) }, order: { stepIndex: 'ASC' } });
      if (open.length) return open;
      created = true;
      const out: ApprovalChainStep[] = [];
      for (const [i, s] of input.steps.entries()) {
        out.push(await repo.save(repo.create({
          tenantId, entityType: input.entityType, entityId: input.entityId, purpose, stepIndex: i, level: s.level,
          approverUserId: s.approverUserId ?? null, approverPermission: s.approverPermission ?? null,
          status: i === 0 ? 'PENDING' : 'WAITING', priority,
          submittedByUserId: input.submittedByUserId ?? null, reason: input.reason ?? null, metadata: input.metadata ?? null,
        })));
      }
      return out;
    });
    if (created) await ApprovalChainService.activate(tenantId, steps[0]!);
    return steps;
  }

  /** Every step of an entity's chains, oldest chain first. */
  static async list(tenantId: string, entityType: string, entityId: string, purpose?: string): Promise<ApprovalChainStep[]> {
    return withTenantRepositoryFor(tenantId, ApprovalChainStep, (repo) => repo.find({
      where: { tenantId, entityType, entityId, ...(purpose ? { purpose } : {}) },
      order: { createdAt: 'ASC', stepIndex: 'ASC' },
    }));
  }

  static async getStep(tenantId: string, stepId: string): Promise<ApprovalChainStep> {
    const row = await withTenantRepositoryFor(tenantId, ApprovalChainStep, (repo) => repo.findOne({ where: { tenantId, stepId } }));
    if (!row) throw new AppError(MSG.STEP_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    return row;
  }

  /**
   * Steps waiting on this user by name, oldest first, with how many wait in all. Unnamed steps are in the general queue.
   * The inbox sorts and searches them in the browser, so it reads the whole set (up to `MY_STEPS_MAX`), not a page.
   */
  static async pendingFor(tenantId: string, userId: string): Promise<{ data: ApprovalChainStep[]; total: number }> {
    const [data, total] = await withTenantRepositoryFor(tenantId, ApprovalChainStep, (repo) => repo.findAndCount({
      where: { tenantId, approverUserId: userId, status: 'PENDING' }, order: { createdAt: 'ASC', stepId: 'ASC' }, take: MY_STEPS_MAX,
    }));
    return { data, total };
  }

  /**
   * Decide the active step. `mayDecideAny`: the caller holds the step's
   * permission or the queue's decide right; otherwise only the named
   * approver may. Nobody decides a chain they submitted.
   */
  static async decide(
    tenantId: string, stepId: string, reviewerUserId: string, decision: 'APPROVE' | 'REJECT',
    opts: { note?: string; mayDecideAny?: boolean; decider?: ApprovalDecider } = {},
  ): Promise<ApprovalChainStep> {
    const step = await this.getStep(tenantId, stepId);
    if (step.status !== 'PENDING' || !step.approvalItemId) throw new AppError(MSG.STEP_NOT_PENDING, 409, ErrorCode.CONFLICT);
    if (step.submittedByUserId && step.submittedByUserId === reviewerUserId) throw new AppError(MSG.STEP_OWN_REQUEST, 403, ErrorCode.FORBIDDEN);
    const named = step.approverUserId === reviewerUserId;
    if (!named && !opts.mayDecideAny) throw new AppError(MSG.STEP_NOT_YOURS, 403, ErrorCode.FORBIDDEN);
    // Through the queue, so the item is audited and the handler below advances the chain.
    const item = await decide(tenantId, reviewerUserId, step.approvalItemId, { decision, note: opts.note }, opts.decider);
    await ApprovalChainService.onQueueDecision(tenantId, item);
    return this.getStep(tenantId, stepId);
  }

  /** The owner settled the entity another way: close its open steps and their queue item. */
  static async cancel(tenantId: string, entityType: string, entityId: string, opts: { purpose?: string; actorId?: string | null; reason?: string } = {}): Promise<number> {
    const { count, activeIds } = await withTenantRepositoryFor(tenantId, ApprovalChainStep, async (repo) => {
      const rows = await repo.find({ where: { tenantId, entityType, entityId, ...(opts.purpose ? { purpose: opts.purpose } : {}), status: In(OPEN) } });
      // Which step had a live queue item, read before the rows change.
      const active = rows.filter((r) => r.status === 'PENDING').map((r) => r.stepId);
      if (rows.length) await repo.update({ tenantId, stepId: In(rows.map((r) => r.stepId)), status: In(OPEN) }, { status: 'CANCELLED', note: opts.reason ?? null });
      return { count: rows.length, activeIds: active };
    });
    for (const stepId of activeIds) {
      try {
        await withdrawForEntity(tenantId, CHAIN_STEP_ENTITY_TYPE, stepId, { actorId: opts.actorId ?? null, reason: opts.reason ?? 'Chain cancelled' });
      } catch (error) {
        Logger.warn(`[approval.chain] queue item not withdrawn tenant=${tenantId} step=${stepId}: ${error}`);
      }
    }
    return count;
  }

  /** The queue's terminal decision on a step's item. Idempotent; never throws. */
  static async onQueueDecision(tenantId: string, item: ApprovalQueueItem): Promise<void> {
    if (item.entityType !== CHAIN_STEP_ENTITY_TYPE) return;
    if (item.status !== 'APPROVED' && item.status !== 'REJECTED') return;
    try {
      const approved = item.status === 'APPROVED';
      const result = await withTenantTransactionFor(tenantId, async (qr) => {
        const repo = qr.manager.getRepository(ApprovalChainStep);
        const step = await repo.findOne({ where: { tenantId, stepId: item.entityId }, lock: { mode: 'pessimistic_write' } });
        if (!step || step.status !== 'PENDING') return null; // already moved: a redelivery, or cancelled
        step.status = approved ? 'APPROVED' : 'REJECTED';
        step.decidedByUserId = item.reviewedByUserId ?? null;
        step.decidedAt = item.reviewedAt ?? new Date();
        step.note = item.decisionNote ?? null;
        await repo.save(step);
        const rest = await repo.find({ where: { tenantId, entityType: step.entityType, entityId: step.entityId, purpose: step.purpose, status: 'WAITING' }, order: { stepIndex: 'ASC' } });
        if (!approved) {
          if (rest.length) await repo.update({ tenantId, stepId: In(rest.map((r) => r.stepId)) }, { status: 'SKIPPED' });
          return { step, next: null, done: true };
        }
        const next = rest[0] ?? null;
        if (next) {
          next.status = 'PENDING';
          await repo.save(next);
        }
        return { step, next, done: !next };
      });
      if (!result) return;
      if (result.next) await ApprovalChainService.activate(tenantId, result.next);
      if (result.done) {
        await ensureApprovalHandlers();
        const owner = OWNERS.get(result.step.entityType);
        if (!owner) {
          Logger.warn(`[approval.chain] no owner registered for ${result.step.entityType}; chain ${result.step.entityId} finished unheard`);
          return;
        }
        await owner.onComplete({
          tenantId, entityType: result.step.entityType, entityId: result.step.entityId, purpose: result.step.purpose,
          outcome: approved ? 'APPROVED' : 'REJECTED', decidedByUserId: item.reviewedByUserId ?? null, note: item.decisionNote ?? null,
        });
      }
    } catch (error) {
      Logger.error(`[approval.chain] decision not applied tenant=${tenantId} item=${item.approvalItemId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A step became PENDING: put it on the queue and tell the owner. */
  private static async activate(tenantId: string, step: ApprovalChainStep): Promise<void> {
    try {
      const item = await submit(tenantId, {
        // No submitter on the item: the queue notifies an item's submitter of every
        // decision, and an intermediate step is not the outcome. The step row keeps
        // who submitted; the owner reports the outcome when the chain finishes.
        entityType: CHAIN_STEP_ENTITY_TYPE, entityId: step.stepId, submittedByUserId: null,
        priority: step.priority, reason: step.reason ?? undefined,
        metadata: {
          ...(step.metadata ?? {}), ownerEntityType: step.entityType, ownerEntityId: step.entityId,
          purpose: step.purpose, level: step.level, stepIndex: step.stepIndex, approverUserId: step.approverUserId ?? null,
        },
      });
      await withTenantRepositoryFor(tenantId, ApprovalChainStep, (repo) => repo.update({ tenantId, stepId: step.stepId }, { approvalItemId: item.approvalItemId }));
      step.approvalItemId = item.approvalItemId;
    } catch (error) {
      Logger.error(`[approval.chain] step not queued tenant=${tenantId} step=${step.stepId}: ${error}`);
    }
    try {
      // The owners register from the same boot registrars as the queue handlers, so a chain started in a route bundle needs them run there too.
      await ensureApprovalHandlers();
      await OWNERS.get(step.entityType)?.onStepActivated?.({ tenantId, step });
    } catch (error) {
      Logger.warn(`[approval.chain] owner step hook failed tenant=${tenantId} step=${step.stepId}: ${error}`);
    }
  }
}
