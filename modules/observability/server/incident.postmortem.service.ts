import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Incident } from './entities/incident.entity'
import { IncidentPostmortem } from './entities/incident_postmortem.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import { listIncidentEvents, recordIncidentEvent } from './incident.timeline.service'
import { buildSummary, buildTimelineText, renderPostmortemMarkdown } from './incident.postmortem.render'
import { getPostmortemPorts } from './incident.postmortem.integration'
import { z } from 'zod'
import { emitObservabilityEvent } from './observability.events'

export const UpdatePostmortemDTO = z.object({
  summary: z.string().max(2000).nullish(),
  impact: z.string().max(20_000).nullish(),
  rootCause: z.string().max(20_000).nullish(),
  contributingFactors: z.string().max(20_000).nullish(),
  wentWell: z.string().max(20_000).nullish(),
  wentPoorly: z.string().max(20_000).nullish(),
  timelineText: z.string().max(40_000).nullish(),
})
export type UpdatePostmortemInput = z.infer<typeof UpdatePostmortemDTO>

/**
 * Post-mortems (observability phase 14): a draft made from the incident's own timeline, a review with a reviewer who is not the author, and
 * publication, which is its own narrow permission because it is an outward act. A published write-up is locked: to change it, withdraw it to a
 * draft, which the timeline records.
 *
 * This entity stays the CONTENT SOURCE. The review goes through the `approval` module when it is in use (entity type `incident_postmortem`; the
 * outcome is mapped back by `incident.postmortem.integration.ts`) and falls back to the original built-in check, marked `reviewMode = BUILTIN`,
 * when it is not. Publication files the rendered write-up as a NEW VERSION of a `document` record (a republication after a withdrawal adds the
 * next version; history is never edited) and keeps the document id on the row.
 */
export default class IncidentPostmortemService {
  static async get(tenantId: string, incidentId: string): Promise<IncidentPostmortem | null> {
    return withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.findOne({ where: { tenantId, incidentId } }))
  }

  /** The existing draft, or a new one prefilled with the summary and the timeline. */
  static async createDraft(tenantId: string, incidentId: string, authorUserId: string | null): Promise<IncidentPostmortem> {
    const existing = await IncidentPostmortemService.get(tenantId, incidentId)
    if (existing) return existing
    const incident = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }))
    if (!incident) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
    const events = await listIncidentEvents(tenantId, incidentId)
    // Public updates are part of the story even when an older incident has no timeline row for them.
    const updates = await withTenantRepositoryFor(tenantId, IncidentUpdate, (repo) => repo.find({ where: { tenantId, incidentId }, order: { createdAt: 'ASC' } }))
    const merged = [...events, ...(events.some((e) => e.type === 'PUBLIC_UPDATE') ? [] : updates.map((u) => ({ type: 'PUBLIC_UPDATE', data: { status: u.status }, createdAt: u.createdAt })))]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    const created = await withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.save(repo.create({
      tenantId, incidentId, status: 'DRAFT', authorUserId, summary: buildSummary(incident), timelineText: buildTimelineText(incident, merged as never),
    })))
    await recordIncidentEvent(tenantId, incidentId, 'POSTMORTEM', { actorId: authorUserId, data: { status: 'DRAFT' } })
    return created
  }

  private static async editable(tenantId: string, incidentId: string): Promise<IncidentPostmortem> {
    const row = await IncidentPostmortemService.get(tenantId, incidentId)
    if (!row) throw new AppError('There is no post-mortem for this incident yet', 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async update(tenantId: string, incidentId: string, patch: UpdatePostmortemInput): Promise<IncidentPostmortem> {
    const row = await IncidentPostmortemService.editable(tenantId, incidentId)
    if (row.status === 'PUBLISHED') throw new AppError('A published post-mortem is locked: withdraw it to a draft first', 409, ErrorCode.CONFLICT)
    // What the reviewers see in the approval queue is what gets published: once a review is open, the text is frozen until it is withdrawn.
    if (row.status === 'IN_REVIEW' && row.reviewMode === 'APPROVAL') throw new AppError('The post-mortem is in review: withdraw it to a draft to edit it', 409, ErrorCode.CONFLICT)
    Object.assign(row, patch)
    return withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.save(row))
  }

  /**
   * DRAFT → IN_REVIEW. The reviewer must not be the author (a second pair of eyes is the point) and the root cause must be written; both are
   * checked BEFORE anything is submitted. With `approval` in use the review is an approval-queue item; without it, the built-in check stands.
   */
  static async submitForReview(tenantId: string, incidentId: string, reviewerUserId: string, actorId: string | null): Promise<IncidentPostmortem> {
    const row = await IncidentPostmortemService.editable(tenantId, incidentId)
    if (row.status !== 'DRAFT') throw new AppError('Only a draft can be sent for review', 409, ErrorCode.CONFLICT)
    if (row.authorUserId && row.authorUserId === reviewerUserId) throw new AppError('The reviewer must be someone other than the author', 400, ErrorCode.VALIDATION_ERROR)
    if (!row.rootCause?.trim()) throw new AppError('Write the root cause before asking for a review', 400, ErrorCode.VALIDATION_ERROR)
    const incident = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }))
    const item = await getPostmortemPorts().approval.submit(tenantId, {
      postmortemId: row.postmortemId, incidentId, reviewerUserId, submittedByUserId: actorId, title: incident?.title ?? 'Incident post-mortem',
    })
    row.status = 'IN_REVIEW'; row.reviewerUserId = reviewerUserId
    row.reviewMode = item ? 'APPROVAL' : 'BUILTIN'; row.approvalItemId = item?.approvalItemId ?? null; row.reviewOutcome = null; row.reviewedAt = null
    const saved = await withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.save(row))
    await recordIncidentEvent(tenantId, incidentId, 'POSTMORTEM', { actorId, data: { status: 'IN_REVIEW', review: row.reviewMode } })
    return saved
  }

  /**
   * IN_REVIEW → PUBLISHED, for a resolved incident. The route guards this with the narrow publish permission. A review that went through
   * `approval` must have been APPROVED first; the rendered write-up is filed as a new `document` version BEFORE the status changes, so a
   * document that cannot be filed leaves the post-mortem exactly as it was (nothing half-published).
   */
  static async publish(tenantId: string, incidentId: string, actorId: string | null): Promise<IncidentPostmortem> {
    const row = await IncidentPostmortemService.editable(tenantId, incidentId)
    if (row.status !== 'IN_REVIEW') throw new AppError('A post-mortem is published after it has been reviewed', 409, ErrorCode.CONFLICT)
    const incident = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }))
    if (!incident || incident.status !== 'RESOLVED') throw new AppError('Only a resolved incident has a published post-mortem', 409, ErrorCode.CONFLICT)
    if (row.reviewMode === 'APPROVAL' && row.reviewOutcome !== 'APPROVED') throw new AppError('The review has not been approved yet', 409, ErrorCode.CONFLICT)
    const filed = await getPostmortemPorts().document.publishVersion(tenantId, {
      documentId: row.documentId ?? null, incidentId, postmortemId: row.postmortemId, title: incident.title,
      markdown: renderPostmortemMarkdown(incident, row), isPrivate: !incident.isPublic, actorId,
      changeNote: row.documentId ? 'Republished after a revision' : 'First publication',
    })
    row.status = 'PUBLISHED'; row.publishedAt = new Date()
    if (filed) { row.documentId = filed.documentId; row.documentVersionNo = filed.versionNo }
    const saved = await withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.save(row))
    await recordIncidentEvent(tenantId, incidentId, 'POSTMORTEM', { actorId, data: { status: 'PUBLISHED', ...(filed ? { documentVersion: filed.versionNo } : {}) } })
    emitObservabilityEvent(tenantId, 'incident.postmortem_published', { incidentId, title: incident.title, severity: incident.severity, publishedAt: saved.publishedAt })
    // Slack / Teams (phase 14.7): the responders' channels are told; a public destination never is (a post-mortem is not on the status page).
    void import('./chat.service').then((m) => m.default.dispatchPostmortemPublished(tenantId, {
      incidentId, title: incident.title, severity: incident.severity, status: incident.status, isPublic: incident.isPublic,
      publicMessage: incident.publicMessage ?? null, reason: null, affectedComponentIds: incident.affectedComponentIds ?? null,
    })).catch(() => undefined)
    // The root cause is the best text a similar-incident lookup can match: index it now (best effort, silent).
    void import('./incident.search').then((m) => m.indexIncident(tenantId, incidentId)).catch(() => undefined)
    return saved
  }

  /** Back to a draft, from review or from published. */
  static async withdraw(tenantId: string, incidentId: string, actorId: string | null): Promise<IncidentPostmortem> {
    const row = await IncidentPostmortemService.editable(tenantId, incidentId)
    if (row.status === 'DRAFT') return row
    const openReview = row.status === 'IN_REVIEW' && row.reviewMode === 'APPROVAL' && !row.reviewOutcome
    row.status = 'DRAFT'; row.publishedAt = null; row.reviewerUserId = null
    // The review starts over; the document (and every version already published in it) stays: a republication adds the next version.
    row.reviewMode = null; row.reviewOutcome = null; row.reviewedAt = null; row.approvalItemId = null
    const saved = await withTenantRepositoryFor(tenantId, IncidentPostmortem, (repo) => repo.save(row))
    if (openReview) await getPostmortemPorts().approval.withdraw(tenantId, row.postmortemId, actorId)
    await recordIncidentEvent(tenantId, incidentId, 'POSTMORTEM', { actorId, data: { status: 'DRAFT', withdrawn: true } })
    return saved
  }
}
