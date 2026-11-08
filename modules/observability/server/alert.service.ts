import 'reflect-metadata'
import { In, MoreThan } from 'typeorm'
import { compactWhere, dayRange, inList, searchWhere, toOrder } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { ALERT_SORTABLE, type ListAlertsQuery } from './alert.dto'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Alert } from './entities/alert.entity'
import { AlertRoute } from './entities/alert_route.entity'
import { AlertSilence } from './entities/alert_silence.entity'
import { AlertDependency } from './entities/alert_dependency.entity'
import { alertFingerprint } from './alert.fingerprint'
import { groupKeyFor, dispatchTimeFor } from './alert.grouping'
import { decide, type Decision } from './alert.decision'
import { entitiesOf } from './alert.inhibit'
import { alertMetrics, suppressionReason } from './alert.metrics'
import type { AlertSignal } from './alert.ingest.parsers'
import type { AlertSeverity, AlertStatus } from './alert.enums'
import { sanitizeLabels, type Labels } from './alert.matchers'
import { assertLabelSetHeadroom, countLabelDrops, isLabelSetGrowthError, sanitizeLabelsReport } from './alert.cardinality'
import { assertOpenAlertHeadroom, isOpenAlertCapError } from './alert.open-cap'
import { alertBuffer, registerUsageDrain } from './observability.metering'
import { dispatchGroup, announceResolved, settleIncident } from './alert.dispatch.service'
import { emitObservabilityEvent } from './observability.events'

/**
 * The alert pipeline's front door (observability phase 11): a signal comes in, becomes (or updates) an alert, is judged once by
 * `decide`, and is either announced by the dispatcher or stored as SUPPRESSED with the reason.
 *
 * Rules the rest of the pipeline relies on:
 *  - ONE non-resolved alert per (tenant, fingerprint), enforced by a partial unique index. A re-fire updates it and bumps `count`.
 *  - An alert is never deleted, only RESOLVED or SUPPRESSED: a silence mutes the announcement, never the record.
 *  - Announcing is a separate step (`dispatchGroup`) so a crash between the two re-announces (at least once) instead of losing the alert.
 */

export interface IngestResult {
  alert: Alert
  created: boolean
  status: AlertStatus
  suppressedBy: string | null
  /** Sender-supplied labels dropped or cut by the cardinality bounds (counted in `alert_labels_dropped_total`). */
  labelsTrimmed?: number
}

const OPEN_STATUSES = ['FIRING', 'SUPPRESSED']
const MAX_CONTEXT_ALERTS = 2000

interface Context {
  routes: AlertRoute[]
  silences: AlertSilence[]
  edges: { child: string; parent: string }[]
  firing: Alert[]
}

async function loadContext(tenantId: string, now: Date): Promise<Context> {
  const [routes, silences, deps, firing] = await Promise.all([
    withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.find({ where: { tenantId, enabled: true }, order: { position: 'ASC' } })),
    withTenantRepositoryFor(tenantId, AlertSilence, (repo) => repo.find({ where: { tenantId, endsAt: MoreThan(now) } })),
    withTenantRepositoryFor(tenantId, AlertDependency, (repo) => repo.find({ where: { tenantId } })),
    withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, status: 'FIRING' }, take: MAX_CONTEXT_ALERTS })),
  ])
  return { routes, silences, edges: deps.map((d) => ({ child: d.child, parent: d.parent })), firing }
}

function firingEntitiesExcept(firing: readonly Alert[], exceptFingerprint?: string): Set<string> {
  const set = new Set<string>()
  for (const a of firing) {
    if (a.fingerprint === exceptFingerprint) continue
    for (const e of entitiesOf(a.labels ?? {})) set.add(e)
  }
  return set
}

function decisionFor(ctx: Context, source: AlertSignal['source'], labels: Labels, duringMaintenance: boolean, now: Date, exceptFingerprint?: string): Decision {
  return decide({
    source, labels, duringMaintenance, routes: ctx.routes, silences: ctx.silences, edges: ctx.edges,
    firingEntities: firingEntitiesExcept(ctx.firing, exceptFingerprint), now,
  })
}

/** Newest announcement time of any alert in the group: what `groupInterval` is measured from. */
async function lastGroupNotifiedAt(tenantId: string, groupKey: string): Promise<Date | null> {
  const rows = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, groupKey }, order: { notifiedAt: 'DESC' }, take: 5 }))
  const times = rows.map((r) => r.notifiedAt).filter((d): d is Date => d != null).map((d) => new Date(d).getTime())
  return times.length ? new Date(Math.max(...times)) : null
}

export default class AlertService {
  /**
   * Accept one signal. Never throws on a bad label or an unknown route target: a sender's mistake must not make the pipeline refuse the
   * next alert. A RESOLVED signal resolves the matching open alert (and is a quiet no-op when there is none).
   */
  static async ingest(tenantId: string, signal: AlertSignal): Promise<IngestResult | null> {
    const { labels, dropped: labelDrops } = sanitizeLabelsReport(signal.labels)
    const labelsTrimmed = countLabelDrops(labelDrops)
    if (!labels.alertname) labels.alertname = signal.title.slice(0, 100)
    const fingerprint = alertFingerprint(signal.source, labels, signal.fingerprint)

    if (signal.status === 'RESOLVED') {
      const resolved = await AlertService.resolve(tenantId, { fingerprint }, signal.endsAt ?? undefined)
      alertMetrics.ingested.inc({ source: signal.source, status: 'RESOLVED' })
      return resolved ? { alert: resolved, created: false, status: 'RESOLVED', suppressedBy: null, labelsTrimmed } : null
    }

    const now = new Date()
    const ctx = await loadContext(tenantId, now)
    const decision = decisionFor(ctx, signal.source, labels, signal.duringMaintenance === true, now, fingerprint)
    const groupKey = groupKeyFor(labels, decision.groupBy, fingerprint)
    const groupLast = await lastGroupNotifiedAt(tenantId, groupKey)
    const timing = dispatchTimeFor(now, groupLast, { groupWaitSeconds: decision.groupWaitSeconds, groupIntervalSeconds: decision.groupIntervalSeconds })

    const { alert, created, becameAnnounceable } = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Alert)
      const existing = await repo.findOne({ where: { tenantId, fingerprint, status: In(OPEN_STATUSES) }, lock: { mode: 'pessimistic_write' } })
      const nextStatus: AlertStatus = decision.suppressedBy ? 'SUPPRESSED' : 'FIRING'
      const severity = signal.severity

      if (existing) {
        const wasSuppressed = existing.status === 'SUPPRESSED'
        Object.assign(existing, {
          title: signal.title, severity, labels, annotations: signal.annotations, lastFiredAt: now, count: existing.count + 1,
          status: nextStatus, suppressedBy: decision.suppressedBy, groupKey, routeId: decision.routeId,
        })
        // Newly announceable (it was muted, now it is not): schedule it. Already announced and still firing: leave it alone.
        const becomes = nextStatus === 'FIRING' && wasSuppressed && !existing.notifiedAt
        if (becomes) existing.dispatchAfter = timing
        if (nextStatus === 'SUPPRESSED') existing.dispatchAfter = null
        return { alert: await repo.save(existing), created: false, becameAnnounceable: becomes }
      }
      // Only what a sender can multiply is capped: our own monitors, SLOs and processes must always be able to raise their alert.
      if (signal.source === 'integration' || signal.source === 'extension') {
        await assertOpenAlertHeadroom(tenantId, () => repo.count({ where: { tenantId, status: In(OPEN_STATUSES) } }))
        await assertLabelSetHeadroom(tenantId, fingerprint)
      }
      const fresh = repo.create({
        tenantId, fingerprint, source: signal.source, sourceRef: signal.sourceRef ?? null, title: signal.title, severity,
        status: nextStatus, suppressedBy: decision.suppressedBy, labels, annotations: signal.annotations, groupKey, routeId: decision.routeId,
        startsAt: signal.startsAt ?? now, endsAt: null, lastFiredAt: now, count: 1,
        dispatchAfter: nextStatus === 'FIRING' ? timing : null, notifiedAt: null, incidentId: null,
      })
      return { alert: await repo.save(fresh), created: true, becameAnnounceable: nextStatus === 'FIRING' }
    })

    alertMetrics.ingested.inc({ source: signal.source, status: alert.status })
    // Metering (phase 16): one unit per NEW alert row, by source: a re-fire of an open alert is not a new alert. Aggregated per minute in this process.
    if (created) { alertBuffer.add(tenantId, 1, { source: signal.source }); void registerUsageDrain() }
    if (decision.suppressedBy) alertMetrics.suppressed.inc({ reason: suppressionReason(decision.suppressedBy) })

    // A new parent outage mutes its children that were already firing.
    if (created && alert.status === 'FIRING' && ctx.edges.length > 0) {
      await AlertService.reevaluate(tenantId).catch((err) => Logger.warn(`[alert] reevaluate failed: ${err instanceof Error ? err.message : String(err)}`))
    }

    if (alert.status === 'FIRING' && (created || becameAnnounceable) && alert.dispatchAfter && new Date(alert.dispatchAfter).getTime() <= now.getTime()) {
      await dispatchGroup(tenantId, groupKey, now).catch((err) => Logger.error(`[alert] dispatch failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`))
    }
    return { alert, created, status: alert.status as AlertStatus, suppressedBy: alert.suppressedBy ?? null, labelsTrimmed }
  }

  static async ingestMany(tenantId: string, signals: readonly AlertSignal[]): Promise<{ accepted: number; resolved: number; suppressed: number; rejected?: number; labelsTrimmed?: number }> {
    let accepted = 0; let resolved = 0; let suppressed = 0; let rejected = 0; let labelsTrimmed = 0
    for (const s of signals) {
      let r: IngestResult | null
      try { r = await AlertService.ingest(tenantId, s) } catch (err) {
        // The open-alert cap refuses THIS alert, not the batch: the ones that are re-fires or resolves still count.
        if (isOpenAlertCapError(err) || isLabelSetGrowthError(err)) { rejected += 1; continue }
        throw err
      }
      if (!r) continue
      labelsTrimmed += r.labelsTrimmed ?? 0
      if (r.status === 'RESOLVED') resolved += 1
      else { accepted += 1; if (r.status === 'SUPPRESSED') suppressed += 1 }
    }
    return { accepted, resolved, suppressed, ...(rejected ? { rejected } : {}), ...(labelsTrimmed ? { labelsTrimmed } : {}) }
  }

  /** Resolve the open alert with this id or fingerprint. A second resolve, or one for an alert that never existed, is a quiet no-op. */
  static async resolve(tenantId: string, ref: { alertId?: string; fingerprint?: string }, endsAt?: Date): Promise<Alert | null> {
    const now = new Date()
    const saved = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Alert)
      const where = ref.alertId ? { tenantId, alertId: ref.alertId, status: In(OPEN_STATUSES) } : { tenantId, fingerprint: ref.fingerprint, status: In(OPEN_STATUSES) }
      const row = await repo.findOne({ where, lock: { mode: 'pessimistic_write' } })
      if (!row) return null
      Object.assign(row, { status: 'RESOLVED', endsAt: endsAt ?? now, dispatchAfter: null })
      return repo.save(row)
    })
    if (!saved) return null
    await announceResolved(tenantId, saved).catch((err) => Logger.warn(`[alert] resolved notice failed: ${err instanceof Error ? err.message : String(err)}`))
    if (saved.incidentId) await settleIncident(tenantId, saved.incidentId).catch((err) => Logger.warn(`[alert] settle incident failed: ${err instanceof Error ? err.message : String(err)}`))
    // Whatever this alert was holding back is now free to be announced.
    await AlertService.reevaluate(tenantId).catch(() => {})
    return saved
  }

  static async acknowledge(tenantId: string, alertId: string, userId: string | null): Promise<Alert> {
    const r = await withTenantTransactionFor(tenantId, async (qr) => {
      const repo = qr.manager.getRepository(Alert)
      const row = await repo.findOne({ where: { tenantId, alertId }, lock: { mode: 'pessimistic_write' } })
      if (!row) throw new AppError('Alert not found', 404, ErrorCode.NOT_FOUND)
      if (row.status === 'RESOLVED') throw new AppError('A resolved alert cannot be acknowledged', 409, ErrorCode.CONFLICT)
      const first = !row.acknowledgedAt
      if (first) Object.assign(row, { acknowledgedAt: new Date(), acknowledgedBy: userId })
      return { saved: await repo.save(row), first }
    })
    if (r.first) {
      emitObservabilityEvent(tenantId, 'alert.acknowledged', {
        alertId: r.saved.alertId, title: r.saved.title, severity: r.saved.severity, source: r.saved.source, status: r.saved.status,
        labels: r.saved.labels, acknowledgedAt: r.saved.acknowledgedAt, acknowledgedBy: r.saved.acknowledgedBy ?? null,
      })
    }
    return r.saved
  }

  static async getById(tenantId: string, alertId: string): Promise<Alert> {
    const row = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.findOne({ where: { tenantId, alertId } }))
    if (!row) throw new AppError('Alert not found', 404, ErrorCode.NOT_FOUND)
    return row
  }

  static async list(tenantId: string, opts: { status?: string; severity?: string; source?: string; limit?: number; offset?: number } = {}): Promise<Alert[]> {
    const where: Record<string, unknown> = { tenantId }
    if (opts.status) where.status = opts.status
    if (opts.severity) where.severity = opts.severity
    if (opts.source) where.source = opts.source
    return withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({
      where, order: { lastFiredAt: 'DESC' }, skip: Math.max(0, opts.offset ?? 0), take: Math.min(200, Math.max(1, opts.limit ?? 100)),
    }))
  }

  /**
   * One page of alerts (phase 43 list contract) with the whole set's count per status, for the console's header and
   * tabs. Labels never sort or search; the title does.
   */
  static async listPage(tenantId: string, query: ListAlertsQuery): Promise<{ data: Alert[]; total: number; counts: Record<string, number> }> {
    const base: Record<string, unknown> = compactWhere({
      tenantId,
      status: inList(query.status),
      severity: inList(query.severity),
      source: inList(query.source),
      lastFiredAt: dayRange(query.lastFiredFrom, query.lastFiredTo),
    })
    const skip = query.offset !== undefined ? query.offset : query.page * query.pageSize
    return withTenantRepositoryFor(tenantId, Alert, async (repo) => {
      const [[data, total], byStatus] = await Promise.all([
        repo.findAndCount({
          where: searchWhere(base, query.search, ['title']) as never,
          order: toOrder(query.sort, ALERT_SORTABLE, { alertId: 'ASC' }) as never,
          skip, take: query.pageSize,
        }),
        repo.createQueryBuilder('a').select('a.status', 'status').addSelect('COUNT(*)', 'count')
          .where('a.tenantId = :tenantId', { tenantId }).groupBy('a.status').getRawMany<{ status: string; count: string }>(),
      ])
      return { data, total, counts: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.count)])) }
    })
  }

  /**
   * Recompute which non-resolved alerts are muted, after anything that can change it (a silence created or expired, a parent outage that
   * started or ended). Only the suppression part is recomputed: routing and grouping stay as they were decided at ingest.
   */
  static async reevaluate(tenantId: string, now: Date = new Date()): Promise<{ suppressed: number; released: number; announced: number }> {
    const ctx = await loadContext(tenantId, now)
    const open = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, status: In(OPEN_STATUSES) }, take: MAX_CONTEXT_ALERTS }))
    let suppressed = 0; let released = 0
    const toDispatch = new Set<string>()
    for (const alert of open) {
      // A planned-maintenance or dropped alert stays as it was decided at ingest; this pass owns silences and the dependency graph.
      if (alert.suppressedBy === 'maintenance' || alert.suppressedBy === 'dropped') continue
      const d = decisionFor(ctx, alert.source as AlertSignal['source'], alert.labels ?? {}, false, now, alert.fingerprint)
      const by = d.suppressedBy === 'dropped' ? null : d.suppressedBy
      if (by && alert.status === 'FIRING') {
        await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.update({ tenantId, alertId: alert.alertId }, { status: 'SUPPRESSED', suppressedBy: by, dispatchAfter: null }))
        suppressed += 1
        alertMetrics.suppressed.inc({ reason: suppressionReason(by) })
      } else if (!by && alert.status === 'SUPPRESSED') {
        const groupKey = alert.groupKey ?? groupKeyFor(alert.labels ?? {}, d.groupBy, alert.fingerprint)
        const last = await lastGroupNotifiedAt(tenantId, groupKey)
        const when = dispatchTimeFor(now, last, { groupWaitSeconds: d.groupWaitSeconds, groupIntervalSeconds: d.groupIntervalSeconds })
        await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.update({ tenantId, alertId: alert.alertId }, { status: 'FIRING', suppressedBy: null, groupKey, routeId: d.routeId, dispatchAfter: alert.notifiedAt ? null : when }))
        released += 1
        if (!alert.notifiedAt && when.getTime() <= now.getTime()) toDispatch.add(groupKey)
      } else if (by && alert.status === 'SUPPRESSED' && alert.suppressedBy !== by) {
        await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.update({ tenantId, alertId: alert.alertId }, { suppressedBy: by }))
      }
    }
    let announced = 0
    for (const key of toDispatch) {
      const r = await dispatchGroup(tenantId, key, now).catch((err) => { Logger.error(`[alert] dispatch failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`); return null })
      announced += r?.announced ?? 0
    }
    return { suppressed, released, announced }
  }

  /**
   * "Where would this alert go?" — the same `decide` as ingest, over the live routes, silences and graph, writing nothing. The answer
   * of the routing simulator, so the simulator cannot drift from the pipeline.
   */
  static async explain(tenantId: string, input: { source?: AlertSignal['source']; labels: Record<string, string>; severity?: AlertSeverity }): Promise<Decision & { groupKey: string }> {
    const now = new Date()
    const labels = sanitizeLabels(input.labels)
    const ctx = await loadContext(tenantId, now)
    const decision = decisionFor(ctx, input.source ?? 'integration', labels, false, now)
    return { ...decision, groupKey: groupKeyFor(labels, decision.groupBy, 'simulated') }
  }
}
