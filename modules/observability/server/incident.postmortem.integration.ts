import 'reflect-metadata'
import Logger from '@kuraykaraaslan-labs/logger'
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { IncidentPostmortem } from './entities/incident_postmortem.entity'
import { loadDocumentPublisher } from './incident.integrations'
import { POSTMORTEM_DOCUMENT_TYPE, POSTMORTEM_OWNER_TYPE, type DocumentPort } from './incident.integration.types'

export { POSTMORTEM_DOCUMENT_TYPE, POSTMORTEM_OWNER_TYPE }
export type { DocumentPort }

/**
 * The post-mortem's two optional neighbours (observability phase 14.6): `approval` for the review and `document` for the published text.
 * `approval` is reached with `import()` behind an activity check; `document` (a Pro module, so not imported by this Core one) contributes to
 * `observability:document-publisher` (`document/server/document.postmortem-publisher`). Observability installs and runs without either;
 * the service then falls back to its original built-in review and publishes without a document, and says so on the row (`reviewMode`).
 *
 * The ports are plain interfaces so a test can plug a fake approval and a fake document service in (`setPostmortemPorts`); the default
 * ports below are the real thing. Nothing here knows the vocabulary of either module beyond its public service.
 */

export const POSTMORTEM_APPROVAL_TYPE = 'incident_postmortem'

export interface ApprovalPort {
  /** Submit the post-mortem for review. Null = the approval module is not in use for this tenant (use the built-in review). */
  submit(tenantId: string, input: { postmortemId: string; incidentId: string; reviewerUserId: string; submittedByUserId: string | null; title: string }): Promise<{ approvalItemId: string } | null>
  /** The review was withdrawn: close the open item. Never throws. */
  withdraw(tenantId: string, postmortemId: string, actorId: string | null): Promise<void>
}

export interface PostmortemPorts { approval: ApprovalPort; document: DocumentPort }

const defaultApproval: ApprovalPort = {
  async submit(tenantId, input) {
    return ifActive(tenantId, 'approval', async () => {
      const { default: ApprovalQueueService } = await import('@kuraykaraaslan-labs/approval/server/approval.service')
      const item = await ApprovalQueueService.submit(tenantId, {
        entityType: POSTMORTEM_APPROVAL_TYPE, entityId: input.postmortemId, submittedByUserId: input.submittedByUserId, priority: 1,
        reason: `Post-mortem review: ${input.title}`.slice(0, 2000),
        metadata: { incidentId: input.incidentId, reviewerUserId: input.reviewerUserId },
      })
      return { approvalItemId: item.approvalItemId }
    })
  },
  async withdraw(tenantId, postmortemId, actorId) {
    try {
      await ifActive(tenantId, 'approval', async () => {
        const { default: ApprovalQueueService } = await import('@kuraykaraaslan-labs/approval/server/approval.service')
        await ApprovalQueueService.withdrawForEntity(tenantId, POSTMORTEM_APPROVAL_TYPE, postmortemId, { actorId: actorId ?? undefined, reason: 'Post-mortem withdrawn to a draft' })
      })
    } catch (err) {
      Logger.warn(`[observability.postmortem] approval item not withdrawn: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
}

const defaultDocument: DocumentPort = {
  async publishVersion(tenantId, input) {
    const publisher = await loadDocumentPublisher(tenantId)
    return publisher ? publisher.publishVersion(tenantId, input) : null
  },
}

let ports: PostmortemPorts = { approval: defaultApproval, document: defaultDocument }
export const getPostmortemPorts = (): PostmortemPorts => ports
/** Test seam: replace one or both ports; no argument restores the real ones. */
export function setPostmortemPorts(next?: Partial<PostmortemPorts>): void {
  ports = { approval: next?.approval ?? defaultApproval, document: next?.document ?? defaultDocument }
}

// ── decision handling ────────────────────────────────────────────────────────────────────────────────────────────

type DecisionItem = { entityId: string; status: string; reviewedByUserId: string | null; approvalItemId?: string }

/**
 * The approval queue's outcome, mapped back onto the post-mortem. APPROVED leaves it IN_REVIEW with `reviewOutcome = APPROVED` (publication is
 * a separate, narrower act and keeps its own permission); REJECTED sends it back to a draft. A decision that the author took on their own
 * write-up is never honoured as a review (the rule "the reviewer must not be the author" holds on the decision as well as on the request):
 * it is recorded as a rejection, so someone else has to review it.
 */
export async function onPostmortemDecision(event: { tenantId: string; item: DecisionItem }): Promise<void> {
  const { tenantId, item } = event
  if (item.status !== 'APPROVED' && item.status !== 'REJECTED') return
  try {
    const { recordIncidentEvent } = await import('./incident.timeline.service')
    const row = await withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.findOne({ where: { tenantId, postmortemId: item.entityId } }))
    // A decision for a review that is no longer the current one (withdrawn and resubmitted) changes nothing.
    if (!row || row.status !== 'IN_REVIEW' || row.reviewMode !== 'APPROVAL' || row.reviewOutcome) return
    if (item.approvalItemId && row.approvalItemId && item.approvalItemId !== row.approvalItemId) return
    const selfReview = item.status === 'APPROVED' && Boolean(row.authorUserId) && row.authorUserId === item.reviewedByUserId
    const approved = item.status === 'APPROVED' && !selfReview
    const patch: Partial<IncidentPostmortem> = approved
      ? { reviewOutcome: 'APPROVED', reviewedAt: new Date(), reviewerUserId: item.reviewedByUserId ?? row.reviewerUserId ?? null }
      : { status: 'DRAFT', reviewOutcome: 'REJECTED', reviewedAt: new Date(), reviewerUserId: null }
    await withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.update({ tenantId, postmortemId: row.postmortemId }, patch))
    await recordIncidentEvent(tenantId, row.incidentId, 'POSTMORTEM', {
      actorId: item.reviewedByUserId, data: approved ? { status: 'IN_REVIEW', reviewed: 'APPROVED' } : { status: 'DRAFT', reviewed: 'REJECTED', ...(selfReview ? { reason: 'reviewer_is_author' } : {}) },
    })
  } catch (err) {
    Logger.warn(`[observability.postmortem] approval decision not applied: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * A pre-decision check for APPROVE (inside the queue's locked transaction): the author cannot approve their own write-up. The queue only knows
 * who CLAIMED the item at this point (the decider is recorded after the guard runs), so this closes the claimed path; the handler above closes the
 * unclaimed one by refusing to treat a self-approval as a review.
 */
export async function guardPostmortemApprove(event: { tenantId: string; item: { entityId: string; reviewedByUserId: string | null } }): Promise<void> {
  const row = await withTenantRepositoryFor(event.tenantId, IncidentPostmortem, (repo) => repo.findOne({ where: { tenantId: event.tenantId, postmortemId: event.item.entityId } }))
  if (row?.authorUserId && event.item.reviewedByUserId && row.authorUserId === event.item.reviewedByUserId) {
    throw new AppError('The reviewer must be someone other than the author', 409, ErrorCode.CONFLICT)
  }
}

/** Boot task (`common:boot_task`, phase approval). A deployment without `approval` has nothing to register. */
export async function registerPostmortemApprovalHandler(): Promise<void> {
  try {
    const handlers = await import('@kuraykaraaslan-labs/approval/server/approval.handlers')
    handlers.registerHandler(POSTMORTEM_APPROVAL_TYPE, onPostmortemDecision as never)
    handlers.registerDecisionGuard(POSTMORTEM_APPROVAL_TYPE, guardPostmortemApprove as never)
    Logger.info('[observability] approval handler registered for incident_postmortem')
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') return
    Logger.warn(`[observability] post-mortem approval handler not registered: ${error instanceof Error ? error.message : String(error)}`)
  }
}
