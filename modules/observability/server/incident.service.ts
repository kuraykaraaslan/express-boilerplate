import 'reflect-metadata'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { In, type QueryRunner } from 'typeorm'
import { compactWhere, dayRange, inList, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { INCIDENT_SORTABLE, type ListIncidentsQuery } from './incident.dto'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Incident } from './entities/incident.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import { StatusPage } from './entities/status_page.entity'
import { publishStatusChanged } from './status.realtime'
import StatusSubscriberService from './status.subscriber.service'
import { recordIncidentEvent } from './incident.timeline.service'
import { emitIncidentWebhook } from './incident.webhook'

export interface OpenIncidentInput {
  monitorId?: string | null
  /** The alert group this incident answers for (`alert.grouping.ts`): one OPEN incident per group. */
  alertGroupKey?: string | null
  title: string
  reason?: string | null
  severity?: string
  isAuto?: boolean
  /** Who declared it (a manual incident); null for an auto-opened one. */
  declaredBy?: string | null
}

/**
 * Outage lifecycle. "At most one OPEN incident per monitor" is enforced by the
 * partial unique index on the entity, so a concurrent probe cannot open a second
 * one — a unique-violation on insert is swallowed and the existing open incident
 * returned (idempotent open).
 */
/**
 * Resolve an incident on the caller's transaction, only if it is still open —
 * the incident row LOCKED. Returns the resolved row, or null when it was
 * already resolved (so the caller does NOT tell subscribers again).
 */
async function resolveLocked(qr: QueryRunner, tenantId: string, incidentId: string, reason?: string): Promise<Incident | null> {
  const repo = qr.manager.getRepository(Incident)
  const row = await repo.findOne({ where: { tenantId, incidentId }, lock: { mode: 'pessimistic_write' } })
  if (!row) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
  if (row.status === 'RESOLVED') return null
  const patch = { status: 'RESOLVED', resolvedAt: new Date(), ...(reason && !row.reason ? { reason } : {}) }
  await repo.update({ tenantId, incidentId }, patch)
  return Object.assign(row, patch)
}

export default class IncidentService {
  /** One incident of this tenant (REST completeness, phase 21.2: the console reads it as part of the list, an API client needs it by id). */
  static async getById(tenantId: string, incidentId: string): Promise<Incident> {
    const row = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }))
    if (!row) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async list(tenantId: string, opts: { monitorId?: string; status?: string; limit?: number } = {}): Promise<Incident[]> {
    const where: Record<string, unknown> = { tenantId }
    if (opts.monitorId) where.monitorId = opts.monitorId
    if (opts.status) where.status = opts.status
    return withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({
      where,
      order: { status: 'ASC', createdAt: 'DESC' },
      take: Math.min(200, Math.max(1, opts.limit ?? 100)),
    }))
  }

  /** One page of incidents (phase 43 list contract): statuses, severities, monitors, a start range, published or not, a title search. */
  static async listPage(tenantId: string, query: ListIncidentsQuery): Promise<{ data: Incident[]; total: number }> {
    const base: Record<string, unknown> = compactWhere({
      tenantId,
      status: inList(query.status),
      severity: inList(query.severity),
      monitorId: inList(query.monitorId),
      startedAt: dayRange(query.startedFrom, query.startedTo),
      isPublic: query.isPublic,
    })
    const [data, total] = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findAndCount({
      where: searchWhere(base, query.search, ['title']) as never,
      order: toOrder(query.sort, INCIDENT_SORTABLE, { incidentId: 'ASC' }, Incident) as never,
      skip: query.page * query.pageSize,
      take: query.pageSize,
    }))
    return { data, total }
  }

  static async openIncident(tenantId: string, input: OpenIncidentInput): Promise<Incident> {
    const findOpen = (monitorId: string) => withTenantRepositoryFor(tenantId, Incident, (repo) =>
      repo.findOne({ where: { tenantId, monitorId, status: 'OPEN' } }))

    const findOpenByGroup = (alertGroupKey: string) => withTenantRepositoryFor(tenantId, Incident, (repo) =>
      repo.findOne({ where: { tenantId, alertGroupKey, status: 'OPEN' } }))

    if (input.alertGroupKey) {
      const existing = await findOpenByGroup(input.alertGroupKey)
      if (existing) return existing
    }
    if (input.monitorId) {
      const existing = await findOpen(input.monitorId)
      if (existing) return existing
    }
    let created: Incident
    try {
      created = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.save(repo.create({
        tenantId,
        monitorId: input.monitorId ?? null,
        alertGroupKey: input.alertGroupKey ?? null,
        title: input.title,
        reason: input.reason ?? null,
        severity: input.severity ?? 'MAJOR',
        isAuto: input.isAuto ?? false,
        declaredBy: input.declaredBy ?? null,
        status: 'OPEN',
        startedAt: new Date(),
      })))
    } catch (err) {
      // Lost the race to another probe (the unique open-incident index) — the
      // failed block rolled back; return the one that won, read afresh.
      if (input.alertGroupKey) {
        const existing = await findOpenByGroup(input.alertGroupKey)
        if (existing) return existing
      }
      if (input.monitorId) {
        const existing = await findOpen(input.monitorId)
        if (existing) return existing
      }
      Logger.warn(`[incident] openIncident failed tenant=${tenantId}: ${err}`)
      throw err
    }
    // Auto incidents open private (isPublic=false) so this reaches nobody
    // until an operator publishes; the live signal is still fired for the
    // component-status change that accompanies an outage.
    void publishStatusChanged(tenantId)
    // The timeline starts here, and webhook / automation subscribers hear about it. Neither can ever fail the open.
    await recordIncidentEvent(tenantId, created.incidentId, 'DECLARED', {
      actorId: input.declaredBy ?? null, data: { auto: Boolean(input.isAuto), severity: created.severity, title: created.title },
    })
    emitIncidentWebhook(tenantId, 'incident.opened', created)
    // The AI investigator may be asked to look at it (phase 20.2). Off unless the tenant switched it on; never fails or delays the open.
    void import('./ai/ai.auto').then((m) => m.maybeInvestigateOnOpen(tenantId, created.incidentId)).catch(() => undefined)
    // Similar-incident retrieval needs the incident in the search index from the moment it exists (best effort, silent).
    void import('./incident.search').then((m) => m.indexIncident(tenantId, created.incidentId)).catch(() => undefined)
    return created
  }

  /**
   * Resolve a monitor's open incident. Two recoveries racing (overlapping
   * probes) used to both resolve it and both email every subscriber
   * "Resolved"; now the second finds it resolved and stays quiet.
   */
  static async resolveOpenIncident(tenantId: string, monitorId: string, reason = 'Recovered'): Promise<Incident | null> {
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      const open = await qr.manager.getRepository(Incident).findOne({ where: { tenantId, monitorId, status: 'OPEN' } })
      if (!open) return null
      return resolveLocked(qr, tenantId, open.incidentId, reason)
    })
    if (!saved) return null
    void publishStatusChanged(tenantId)
    void StatusSubscriberService.notifyIncident(tenantId, saved, 'resolved')
    await IncidentService.settled(tenantId, saved, null)
    return saved
  }

  /** What happens once an incident is resolved, wherever the resolve came from: the timeline entry and the webhook event. */
  private static async settled(tenantId: string, incident: Incident, actorId: string | null): Promise<void> {
    await recordIncidentEvent(tenantId, incident.incidentId, 'RESOLVED', { actorId })
    emitIncidentWebhook(tenantId, 'incident.resolved', incident)
    // Best effort and silent, none of it can fail or delay the resolve: the resolved incident becomes retrievable as a similar incident
    // (text index, and an embedding when the tenant opted in), and the investigator may take one more look with the whole picture.
    void import('./incident.search').then((m) => m.indexIncident(tenantId, incident.incidentId)).catch(() => undefined)
    void import('./incident.embedding.hooks').then((m) => m.embedResolvedIncident(tenantId, incident.incidentId)).catch(() => undefined)
    void import('./ai/ai.auto').then((m) => m.maybeInvestigateOnResolve(tenantId, incident.incidentId)).catch(() => undefined)
  }

  /**
   * Resolve an AUTO-opened incident because every alert it answered for has recovered. A manually opened incident is a person's
   * record and is never closed by the machine; an already-resolved one stays quiet (no second "Resolved" mail).
   */
  static async resolveAutoById(tenantId: string, incidentId: string, reason = 'Recovered'): Promise<Incident | null> {
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      const open = await qr.manager.getRepository(Incident).findOne({ where: { tenantId, incidentId, status: 'OPEN' } })
      if (!open || !open.isAuto) return null
      return resolveLocked(qr, tenantId, incidentId, reason)
    })
    if (!saved) return null
    void publishStatusChanged(tenantId)
    void StatusSubscriberService.notifyIncident(tenantId, saved, 'resolved')
    await IncidentService.settled(tenantId, saved, null)
    return saved
  }

  /**
   * Operator resolve. Resolving an already-resolved incident is a no-op —
   * it used to reset `resolvedAt` and send the "Resolved" mail again.
   */
  static async resolveById(tenantId: string, incidentId: string, actorId: string | null = null): Promise<Incident> {
    const saved = await withTenantTransactionFor(tenantId, (qr) => resolveLocked(qr, tenantId, incidentId))
    if (!saved) {
      return withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOneOrFail({ where: { tenantId, incidentId } }))
    }
    void publishStatusChanged(tenantId)
    void StatusSubscriberService.notifyIncident(tenantId, saved, 'resolved')
    await IncidentService.settled(tenantId, saved, actorId)
    return saved
  }

  static async updateIncident(
    tenantId: string,
    incidentId: string,
    data: {
      title?: string
      severity?: string
      isPublic?: boolean
      publicMessage?: string | null
      affectedComponentIds?: string[] | null
      audiencePageIds?: string[] | null
    },
    actorId: string | null = null,
  ): Promise<Incident> {
    // Flagging a private incident for restricted pages: each id must be a RESTRICTED page of this tenant (a public page never shows one, so naming it
    // would promise something the serializer refuses to do). Empty means none.
    if (data.audiencePageIds !== undefined) {
      const ids = [...new Set(data.audiencePageIds ?? [])]
      if (ids.length) {
        const pages = await withTenantRepositoryFor(tenantId, StatusPage, (repo) => repo.find({ where: { tenantId, pageId: In(ids) } }))
        if (pages.length !== ids.length || pages.some((p) => p.audience === 'PUBLIC')) {
          throw new AppError('Choose pages of this workspace that have a restricted audience', 422, ErrorCode.VALIDATION_ERROR)
        }
      }
      data = { ...data, audiencePageIds: ids.length ? ids : null }
    }
    // Locked: two concurrent "publish" clicks both saw isPublic=false and both
    // sent the "opened" mail to every subscriber.
    const { saved, wasPublic, wasSeverity } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Incident)
      const row = await repo.findOne({ where: { tenantId, incidentId }, lock: { mode: 'pessimistic_write' } })
      if (!row) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
      const before = row.isPublic
      const severityBefore = row.severity
      Object.assign(row, data)
      // A public incident is on every page it touches; a stale flag must not come back when it is unpublished later.
      if (data.isPublic === true) row.audiencePageIds = null
      return { saved: await repo.save(row), wasPublic: before, wasSeverity: severityBefore }
    })
    if (data.severity !== undefined && data.severity !== wasSeverity) {
      await recordIncidentEvent(tenantId, incidentId, 'SEVERITY_CHANGED', { actorId, data: { from: wasSeverity, to: data.severity } })
    }
    if (data.isPublic !== undefined && data.isPublic !== wasPublic) {
      await recordIncidentEvent(tenantId, incidentId, data.isPublic ? 'PUBLISHED' : 'UNPUBLISHED', { actorId })
    }
    emitIncidentWebhook(tenantId, 'incident.updated', saved, { change: 'edited' }, { becamePublic: !wasPublic && saved.isPublic })
    if (data.title !== undefined || data.severity !== undefined) void import('./incident.search').then((m) => m.indexIncident(tenantId, incidentId)).catch(() => undefined)
    void publishStatusChanged(tenantId)
    // First publication is the moment subscribers learn about it.
    if (!wasPublic && saved.isPublic) {
      void StatusSubscriberService.notifyIncident(tenantId, saved, 'opened')
    }
    return saved
  }

  static async listUpdates(tenantId: string, incidentId: string): Promise<IncidentUpdate[]> {
    return withTenantRepositoryFor(tenantId, IncidentUpdate, (repo) => repo.find({
      where: { tenantId, incidentId },
      order: { createdAt: 'ASC' },
    }))
  }

  static async addUpdate(
    tenantId: string,
    incidentId: string,
    data: { status: string; publicMessage: string },
    actorId: string | null = null,
  ): Promise<IncidentUpdate> {
    // The timeline entry and a RESOLVED transition commit together, on the
    // locked incident.
    const { update, incident } = await withTenantTransactionFor(tenantId, async (qr) => {
      const row = await qr.manager.getRepository(Incident).findOne({
        where: { tenantId, incidentId },
        lock: { mode: 'pessimistic_write' },
      })
      if (!row) throw new AppError('Incident not found', 404, ErrorCode.NOT_FOUND)
      const repo = qr.manager.getRepository(IncidentUpdate)
      const saved = await repo.save(repo.create({
        tenantId, incidentId,
        status: data.status,
        publicMessage: data.publicMessage,
      }))
      if (data.status === 'RESOLVED' && row.status !== 'RESOLVED') {
        const patch = { status: 'RESOLVED', resolvedAt: new Date() }
        await qr.manager.getRepository(Incident).update({ tenantId, incidentId }, patch)
        Object.assign(row, patch)
      }
      return { update: saved, incident: row }
    })
    void publishStatusChanged(tenantId)
    void StatusSubscriberService.notifyIncident(
      tenantId, incident, data.status === 'RESOLVED' ? 'resolved' : 'updated',
    )
    await recordIncidentEvent(tenantId, incidentId, 'PUBLIC_UPDATE', { actorId, data: { status: data.status } })
    if (data.status === 'RESOLVED') await IncidentService.settled(tenantId, incident, actorId)
    else emitIncidentWebhook(tenantId, 'incident.updated', incident, { change: 'update', updateStatus: data.status }, { updateMessage: data.publicMessage })
    return update
  }
}
