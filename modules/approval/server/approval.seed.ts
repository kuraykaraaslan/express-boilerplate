import 'reflect-metadata'
import type { SeedContext } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { SEED_USER_ID, SEED_ADMIN_USER_ID } from '@kuraykaraaslan-labs/db/server/db.seed-contracts'
import { ApprovalQueueItem } from './entities/approval_queue_item.entity'
import { ApprovalChainStep } from './entities/approval_chain_step.entity'
import { chainOnInsert } from './approval.chain'
import { approvalSlaDueAt, sealDecision } from './approval.constants'

/**
 * Approval-queue seed: `ApprovalQueueItem` is the platform's polymorphic
 * seam — keyed by a bare `(entityType, entityId)` (`coupon_redemption`'s
 * `subjectType`/`subjectId` is the same pattern under a different name) — so
 * this seed's whole job is pointing that seam at rows OTHER modules produced:
 * `quote` (`refs.quoteId` / `refs.quoteAcceptedId`), `contract`
 * (`refs.contractId` / `refs.contractRunningId`), `project`
 * (`refs.projectTaskId`) and `support` (`refs.supportTicketId`). Two rows use a
 * plausible standalone uuid instead — a legitimate case per the entity's own
 * doc comment ("any owning module", not just the four seeded here) and the
 * same fallback-literal style `coupon.seed.ts` uses for ids it does not own.
 *
 * All five `ApprovalStatus` values are covered (PENDING ×2, IN_REVIEW,
 * ESCALATED, APPROVED ×2, REJECTED ×2).
 *
 * The row calls `chainOnInsert` directly — the exact function `submit()` uses
 * — rather than the `submit`/`decide` services themselves, because those also
 * fire webhooks, in-app notifications and audit-log writes; seeding is not a
 * real event and must not manufacture a fake one. `decide()`'s own behaviour
 * (mutate status/reviewer fields, do NOT re-chain) is mirrored for the
 * terminal/claimed rows below, so `verifyChain` reads this data exactly as it
 * would a hand-decided queue.
 *
 * Multi-step chains (`approval_chain_steps`) are seeded by `seedChainSteps`
 * below, covering all six step statuses over four chains (see its doc).
 */
export async function seedApproval(ctx: SeedContext): Promise<void> {
  const { tenantId, refs } = ctx
  const submitterId = (refs.userId as string) ?? SEED_USER_ID
  const reviewerId = (refs.adminUserId as string) ?? SEED_ADMIN_USER_ID

  const now = new Date()
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  const fallbackContractId = 'c1000000-0000-4000-8000-000000000001'
  const fallbackContractId2 = 'c1000000-0000-4000-8000-000000000005'
  const fallbackQuoteId = 'c1000000-0000-4000-8000-000000000002'
  const fallbackQuoteId2 = 'c1000000-0000-4000-8000-000000000006'
  // Its own stand-in (appendix A, fixed 2026-10-20): sharing fallbackContractId made the idempotence probe skip the ESCALATED item.
  const fallbackContractRunningId = 'c1000000-0000-4000-8000-000000000007'
  // Same reason: the accepted quote shared fallbackQuoteId with the rejected one, so with no refs the probe skipped one of them.
  const fallbackQuoteAcceptedId = 'c1000000-0000-4000-8000-000000000008'

  type Decision = { status: 'APPROVED' | 'REJECTED' | 'ESCALATED'; note?: string; reviewedAt: Date }
  type ItemDef = {
    entityType: string
    entityId: string
    submittedByUserId?: string | null
    priority: number
    reason: string
    metadata?: Record<string, unknown> | null
    createdAt: Date
    claimedBy?: string | null
    decision?: Decision
  }

  // Sequenced OLDEST → NEWEST: `chainOnInsert` links each new row to the
  // current tenant head, so insertion order here IS the hash-chain order.
  const defs: ItemDef[] = [
    {
      entityType: 'quote',
      entityId: (refs.quoteAcceptedId as string) ?? fallbackQuoteAcceptedId,
      submittedByUserId: submitterId,
      priority: 2,
      reason: 'İskonto oranı %18, onay eşiği %15\'i aşıyor.',
      metadata: { discountPercent: '18.0000', thresholdPercent: '15.0000' },
      createdAt: daysAgo(19),
      decision: { status: 'APPROVED', note: 'Yıllık bakım yenilemesi, onaylandı ve gönderildi.', reviewedAt: daysAgo(18) },
    },
    {
      entityType: 'quote',
      entityId: fallbackQuoteId,
      submittedByUserId: submitterId,
      priority: 1,
      reason: 'İskonto oranı %35, onay eşiği %15\'i aşıyor.',
      metadata: { discountPercent: '35.0000', thresholdPercent: '15.0000' },
      createdAt: daysAgo(12),
      decision: { status: 'REJECTED', note: 'İskonto oranı çok yüksek, satış temsilcisiyle görüşülecek.', reviewedAt: daysAgo(11) },
    },
    {
      entityType: 'quote',
      entityId: (refs.quoteId as string) ?? fallbackQuoteId2,
      submittedByUserId: submitterId,
      priority: 2,
      reason: 'İskonto oranı %27, onay eşiği %15\'i aşıyor.',
      metadata: { discountPercent: '27.0000', thresholdPercent: '15.0000' },
      createdAt: daysAgo(1),
    },
    {
      entityType: 'contract',
      entityId: (refs.contractId as string) ?? fallbackContractId,
      submittedByUserId: submitterId,
      priority: 1,
      reason: 'Hukuk departmanı, imza öncesi çerçeve sözleşme şartlarını inceliyor.',
      createdAt: daysAgo(4),
      claimedBy: reviewerId,
    },
    {
      entityType: 'contract',
      entityId: (refs.contractRunningId as string) ?? fallbackContractRunningId,
      submittedByUserId: submitterId,
      priority: 3,
      reason: 'Zeyilname ile sözleşme değeri onay limitinin üzerine çıktı, üst yönetime iletildi.',
      metadata: { newValueMinor: '12000000', approvalLimitMinor: '10000000' },
      createdAt: daysAgo(58),
      decision: { status: 'ESCALATED', note: 'Genel müdür onayına iletildi.', reviewedAt: daysAgo(57) },
    },
    {
      entityType: 'contract',
      entityId: fallbackContractId2,
      submittedByUserId: submitterId,
      priority: 0,
      reason: 'Standart NDA şablonu — hukuk ön onayı.',
      createdAt: daysAgo(90),
      decision: { status: 'APPROVED', note: 'Standart şartlarla onaylandı.', reviewedAt: daysAgo(89) },
    },
    {
      entityType: 'project_task',
      entityId: (refs.projectTaskId as string) ?? 'c1000000-0000-4000-8000-000000000003',
      submittedByUserId: submitterId,
      priority: 1,
      reason: 'Tahmini süre aşımı: ek 40 saat için bütçe onayı gerekiyor.',
      createdAt: daysAgo(2),
    },
    {
      entityType: 'support_ticket',
      entityId: (refs.supportTicketId as string) ?? 'c1000000-0000-4000-8000-000000000004',
      submittedByUserId: submitterId,
      priority: 0,
      reason: 'Politika dışı iade talebi — yönetici onayı istendi.',
      createdAt: daysAgo(20),
      decision: { status: 'REJECTED', note: 'Politika gereği reddedildi; müşteriye bilgi verildi.', reviewedAt: daysAgo(19) },
    },
  ]

  const repo = ctx.repo<ApprovalQueueItem>(ApprovalQueueItem)
  let created = 0
  for (const def of defs) {
    const existing = await repo.findOne({
      where: { tenantId, entityType: def.entityType, entityId: def.entityId },
    })
    if (existing) continue

    const built = repo.create({
      tenantId,
      entityType: def.entityType,
      entityId: def.entityId,
      submittedByUserId: def.submittedByUserId ?? null,
      status: 'PENDING',
      priority: def.priority,
      reason: def.reason,
      decisionNote: null,
      reviewedByUserId: null,
      reviewedAt: null,
      slaDueAt: approvalSlaDueAt(def.priority, def.createdAt),
      metadata: def.metadata ?? null,
      createdAt: def.createdAt,
    })
    let saved = await repo.save(built)
    // The chain hashes only immutable insert-time content, so this — the exact
    // helper `submit()` calls — is safe to run outside a transaction here.
    saved = await chainOnInsert({ manager: ctx.ds.manager }, tenantId, saved)

    // Mirror `claim()` / `decide()`'s field mutations WITHOUT re-chaining —
    // exactly like the real services, which chain only on insert and re-seal the decision (approval.06).
    if (def.claimedBy) {
      saved.status = 'IN_REVIEW'
      saved.reviewedByUserId = def.claimedBy
      saved = await repo.save(sealDecision(saved))
    }
    if (def.decision) {
      saved.status = def.decision.status
      saved.reviewedByUserId = reviewerId
      saved.decisionNote = def.decision.note ?? null
      saved.reviewedAt = def.decision.reviewedAt
      saved = await repo.save(sealDecision(saved))
    }
    created += 1
  }

  ctx.log(`approval: ${created} queue items created (${defs.length} defined) for ${tenantId}`)

  const chainCreated = await seedChainSteps(ctx, submitterId, reviewerId, daysAgo)
  ctx.log(`approval: ${chainCreated} chain steps created for ${tenantId}`)
}

type ChainStepDef = {
  level: string
  /** Named approver (null = anyone the step's permission admits). */
  named: boolean
  permission?: string
  status: 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'CANCELLED'
  /** Decision note (APPROVED / REJECTED) or the cancellation reason (CANCELLED). */
  note?: string
  /** Days before now the step was decided / cancelled. */
  decidedDaysAgo?: number
}
type ChainDef = {
  entityType: string
  entityId: string
  purpose: string
  priority: number
  reason: string
  createdDaysAgo: number
  steps: ChainStepDef[]
}

/**
 * Multi-step approval chains: four chains over four entities, together covering
 * every step status (`WAITING | PENDING | APPROVED | REJECTED | SKIPPED |
 * CANCELLED`) and two purposes (`REQUEST`, `CANCELLATION`):
 *
 * - leave request A: MANAGER approved, HR approved (finished, approved)
 * - leave request B: MANAGER rejected, HR skipped (finished, rejected)
 * - expense C: MANAGER pending (named approver), FINANCE waiting (open chain)
 * - leave request D (CANCELLATION chain): both steps cancelled, the owner settled it another way
 *
 * Each step that ever became active also gets the queue item `activate()` would
 * have created (entityType `approval_chain_step`, entityId = stepId, no
 * submitter) in the matching terminal status (APPROVED / REJECTED / WITHDRAWN)
 * or PENDING, hash-chained with `chainOnInsert`. Rows are written through
 * repositories only: the chain service would also notify approvers and call
 * owner callbacks, and a seed must not manufacture those events.
 */
async function seedChainSteps(
  ctx: SeedContext,
  submitterId: string,
  reviewerId: string,
  daysAgo: (n: number) => Date,
): Promise<number> {
  const { tenantId } = ctx
  const refs = ctx.refs
  const chains: ChainDef[] = [
    {
      entityType: 'leave_request',
      entityId: (refs.leaveRequestId as string) ?? 'c1000000-0000-4000-8000-000000000011',
      purpose: 'REQUEST', priority: 1, reason: 'Annual leave, 5 working days.', createdDaysAgo: 30,
      steps: [
        { level: 'MANAGER', named: true, status: 'APPROVED', note: 'Coverage arranged, approved.', decidedDaysAgo: 29 },
        { level: 'HR', named: false, permission: 'hr_leave.requests.approve', status: 'APPROVED', note: 'Balance sufficient.', decidedDaysAgo: 28 },
      ],
    },
    {
      entityType: 'leave_request',
      entityId: 'c1000000-0000-4000-8000-000000000012',
      purpose: 'REQUEST', priority: 0, reason: 'Unpaid leave, 10 working days.', createdDaysAgo: 21,
      steps: [
        { level: 'MANAGER', named: true, status: 'REJECTED', note: 'Overlaps the quarter-end release.', decidedDaysAgo: 20 },
        { level: 'HR', named: false, permission: 'hr_leave.requests.approve', status: 'SKIPPED' },
      ],
    },
    {
      entityType: 'expense_claim',
      entityId: 'c1000000-0000-4000-8000-000000000013',
      purpose: 'REQUEST', priority: 2, reason: 'Conference travel, above the single-approver limit.', createdDaysAgo: 3,
      steps: [
        { level: 'MANAGER', named: true, status: 'PENDING' },
        { level: 'FINANCE', named: false, permission: 'hr_expense.claims.approve', status: 'WAITING' },
      ],
    },
    {
      entityType: 'leave_request',
      entityId: 'c1000000-0000-4000-8000-000000000014',
      purpose: 'CANCELLATION', priority: 0, reason: 'Cancellation of an approved leave.', createdDaysAgo: 8,
      steps: [
        { level: 'MANAGER', named: true, status: 'CANCELLED', note: 'Cancelled: the request was withdrawn by the employee.', decidedDaysAgo: 7 },
        { level: 'HR', named: false, permission: 'hr_leave.requests.approve', status: 'CANCELLED', note: 'Cancelled: the request was withdrawn by the employee.', decidedDaysAgo: 7 },
      ],
    },
  ]

  const stepRepo = ctx.repo<ApprovalChainStep>(ApprovalChainStep)
  const itemRepo = ctx.repo<ApprovalQueueItem>(ApprovalQueueItem)
  let created = 0

  for (const chain of chains) {
    const chainCreatedAt = daysAgo(chain.createdDaysAgo)
    for (const [stepIndex, def] of chain.steps.entries()) {
      const where = { tenantId, entityType: chain.entityType, entityId: chain.entityId, purpose: chain.purpose, stepIndex }
      let step = await stepRepo.findOne({ where })
      if (!step) {
        const decided = def.status === 'APPROVED' || def.status === 'REJECTED'
        const settledAt = def.decidedDaysAgo !== undefined ? daysAgo(def.decidedDaysAgo) : null
        step = await stepRepo.save(stepRepo.create({
          tenantId,
          entityType: chain.entityType,
          entityId: chain.entityId,
          purpose: chain.purpose,
          stepIndex,
          level: def.level,
          approverUserId: def.named ? reviewerId : null,
          approverPermission: def.named ? null : (def.permission ?? null),
          status: def.status,
          approvalItemId: null,
          priority: chain.priority,
          submittedByUserId: submitterId,
          reason: chain.reason,
          metadata: null,
          decidedByUserId: decided ? reviewerId : null,
          decidedAt: decided ? settledAt : null,
          note: def.note ?? null,
          createdAt: chainCreatedAt,
        }))
        created += 1
      }

      // WAITING and SKIPPED steps never became active, so they have no queue item.
      if (def.status === 'WAITING' || def.status === 'SKIPPED') continue
      if (step.approvalItemId) continue
      const itemStatus = def.status === 'CANCELLED' ? 'WITHDRAWN' : def.status
      let item = await itemRepo.findOne({ where: { tenantId, entityType: 'approval_chain_step', entityId: step.stepId } })
      if (!item) {
        item = await itemRepo.save(itemRepo.create({
          tenantId,
          entityType: 'approval_chain_step',
          entityId: step.stepId,
          submittedByUserId: null,
          status: 'PENDING',
          priority: chain.priority,
          reason: chain.reason,
          decisionNote: null,
          reviewedByUserId: null,
          reviewedAt: null,
          slaDueAt: approvalSlaDueAt(chain.priority, chainCreatedAt),
          metadata: {
            ownerEntityType: chain.entityType, ownerEntityId: chain.entityId, purpose: chain.purpose,
            level: def.level, stepIndex, approverUserId: def.named ? reviewerId : null,
          },
          createdAt: chainCreatedAt,
        }))
        item = await chainOnInsert({ manager: ctx.ds.manager }, tenantId, item)
        // Mirror decide() / withdrawForEntity(): mutate, never re-chain.
        if (itemStatus !== 'PENDING') {
          item.status = itemStatus
          item.reviewedAt = step.decidedAt ?? (def.decidedDaysAgo !== undefined ? daysAgo(def.decidedDaysAgo) : null)
          item.decisionNote = def.note ?? null
          if (itemStatus === 'APPROVED' || itemStatus === 'REJECTED') item.reviewedByUserId = reviewerId
          item = await itemRepo.save(sealDecision(item))
        }
      }
      step.approvalItemId = item.approvalItemId
      await stepRepo.save(step)
    }
  }
  return created
}
