import 'reflect-metadata'
import { In, IsNull, LessThan, MoreThanOrEqual, Or } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheck } from './entities/monitor_check.entity'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { Incident } from './entities/incident.entity'
import { loadContext } from './slo.service'
import { retentionDaysFor } from './observability.limits'
import {
  DAY_MS, REPORT_NOTES, combineVoters, computeSlaRow, sampleCoverMs, voterSets,
  type ReportPeriod, type RollupCounts, type SlaReport, type SlaRow, type SlaSample, type VoterSets,
} from './sla.report'

/**
 * SLA reports over the uptime data (observability phase 13.5). The arithmetic is `sla.report.ts` (pure); this file reads what it needs and bounds
 * what a request can cost:
 *
 *  - a report covers at most 92 days (`resolvePeriod`) and at most `MAX_MONITORS` distinct monitors;
 *  - raw samples are read monitor by monitor, reduced to interval lists at once and dropped, and the whole request may read at most
 *    `MAX_SAMPLES` rows: past that the answer is a 422 asking for a shorter period or fewer components, never a slow query;
 *  - at most `MAX_CONCURRENT_PER_TENANT` reports are built at the same time for one tenant (a further one is a 429);
 *  - a period that starts before the raw-check retention has no raw samples to read, so it costs only the rollup.
 */

export const MAX_MONITORS = 300
export const MAX_SAMPLES = 1_500_000
export const MAX_CONCURRENT_PER_TENANT = 2
const MAX_INCIDENT_ROWS = 5000

// ---- the reader --------------------------------------------------------------------------------------------------------------------

export interface SlaMonitor { monitorId: string; name: string; intervalSeconds: number }
export interface RawSample extends SlaSample { locationKey: string | null }
export interface IncidentRef { monitorId: string | null; affectedComponentIds: string[] | null }

export interface SlaReader {
  monitors(tenantId: string, ids: readonly string[]): Promise<SlaMonitor[]>
  /** Raw samples with `from <= checkedAt < to`, oldest first, at most `limit` of them. */
  samples(tenantId: string, monitorId: string, from: Date, to: Date, limit: number): Promise<RawSample[]>
  /** The daily rollup of these monitors for the UTC days `fromDay` to `toDay`, both inclusive: good = up + degraded, bad = down. */
  rollup(tenantId: string, monitorIds: readonly string[], fromDay: string, toDay: string): Promise<RollupCounts>
  /** Incidents that overlap [from, to): started before `to` and not resolved before `from`. */
  incidents(tenantId: string, from: Date, to: Date): Promise<IncidentRef[]>
}

export const dbSlaReader: SlaReader = {
  async monitors(tenantId, ids) {
    if (ids.length === 0) return []
    const rows = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.find({ where: { tenantId, monitorId: In([...ids]) } }))
    return rows.map((m) => ({ monitorId: m.monitorId, name: m.name, intervalSeconds: m.intervalSeconds }))
  },

  async samples(tenantId, monitorId, from, to, limit) {
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo.createQueryBuilder('c')
      .select('c.checkedAt', 'checkedAt').addSelect('c.status', 'status').addSelect('c.duringMaintenance', 'maintenance').addSelect('c.locationKey', 'locationKey')
      .where('c.tenantId = :tenantId', { tenantId })
      .andWhere('c.monitorId = :monitorId', { monitorId })
      .andWhere('c.checkedAt >= :from AND c.checkedAt < :to', { from, to })
      .orderBy('c.checkedAt', 'ASC')
      .limit(limit)
      .getRawMany<{ checkedAt: Date | string; status: string; maintenance: boolean; locationKey: string | null }>())
    return rows.map((r) => ({ t: new Date(r.checkedAt).getTime(), status: r.status, maintenance: r.maintenance === true, locationKey: r.locationKey ?? null }))
  },

  async rollup(tenantId, monitorIds, fromDay, toDay) {
    if (monitorIds.length === 0) return { good: 0, bad: 0 }
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) => repo.find({ where: { tenantId, monitorId: In([...monitorIds]), day: MoreThanOrEqual(fromDay) } }))
    return rows.filter((r) => String(r.day).slice(0, 10) <= toDay).reduce<RollupCounts>((a, r) => ({ good: a.good + r.up + r.degraded, bad: a.bad + r.down }), { good: 0, bad: 0 })
  },

  async incidents(tenantId, from, to) {
    const rows = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({
      where: { tenantId, startedAt: LessThan(to), resolvedAt: Or(IsNull(), MoreThanOrEqual(from)) }, take: MAX_INCIDENT_ROWS,
    }))
    return rows.map((i) => ({ monitorId: i.monitorId ?? null, affectedComponentIds: i.affectedComponentIds ?? null }))
  },
}

// ---- bounds ------------------------------------------------------------------------------------------------------------------------

const inFlight = new Map<string, number>()

/** Run `fn` holding one of the tenant's few report slots; a further request while they are taken is refused at once (429). */
export async function withReportSlot<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const current = inFlight.get(tenantId) ?? 0
  if (current >= MAX_CONCURRENT_PER_TENANT) {
    throw new AppError('Too many reports are being built for this workspace. Try again in a moment.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: true, headers: { 'Retry-After': '10' } })
  }
  inFlight.set(tenantId, current + 1)
  try { return await fn() } finally {
    const left = (inFlight.get(tenantId) ?? 1) - 1
    if (left <= 0) inFlight.delete(tenantId); else inFlight.set(tenantId, left)
  }
}

// ---- the report --------------------------------------------------------------------------------------------------------------------

export interface ReportGroup {
  key: string
  name: string
  monitorIds: string[]
  /** Incidents that name this component count for the group even when no monitor is tagged. */
  componentId: string | null
  objectivePercent: number | null
}

export interface BuildArgs {
  tenantId: string
  scope: SlaReport['scope']
  groups: ReportGroup[]
  period: ReportPeriod
  now?: Date
  reader?: SlaReader
  /** Test seams: the settings the report would read. */
  context?: { excludeMaintenance: boolean; retentionDays: number }
}

const tooMuch = (): AppError => new AppError('That report would read too much data: choose a shorter period or fewer components.', 422, ErrorCode.VALIDATION_ERROR)

export async function buildSlaReport(args: BuildArgs): Promise<SlaReport> {
  const { tenantId, scope, groups, period } = args
  const now = args.now ?? new Date()
  const reader = args.reader ?? dbSlaReader
  const distinct = [...new Set(groups.flatMap((g) => g.monitorIds))]
  if (distinct.length > MAX_MONITORS) throw new AppError(`A report covers at most ${MAX_MONITORS} monitors.`, 422, ErrorCode.VALIDATION_ERROR)

  const ctx = args.context ?? await (async () => {
    const c = await loadContext(tenantId, undefined, now)
    return { excludeMaintenance: c.excludeMaintenance, retentionDays: await retentionDaysFor(tenantId, c.retentionDays) }
  })()

  const interval = period.interval
  const rawFloor = now.getTime() - ctx.retentionDays * DAY_MS
  const timelineOk = interval.start >= rawFloor
  const timelineReason = `older than the raw-check retention (${ctx.retentionDays} days)`

  // One pass per monitor: raw samples -> one voter per (monitor, location); the samples are dropped as soon as the interval lists exist.
  const voters = new Map<string, VoterSets[]>()
  if (timelineOk && distinct.length > 0) {
    const monitors = new Map((await reader.monitors(tenantId, distinct)).map((m) => [m.monitorId, m]))
    let budget = MAX_SAMPLES
    for (const monitorId of distinct) {
      const monitor = monitors.get(monitorId)
      if (!monitor) { voters.set(monitorId, []); continue }
      const cover = sampleCoverMs(monitor.intervalSeconds)
      const samples = await reader.samples(tenantId, monitorId, new Date(interval.start - cover), new Date(interval.end), budget + 1)
      if (samples.length > budget) throw tooMuch()
      budget -= samples.length
      const byLocation = new Map<string, SlaSample[]>()
      for (const s of samples) { const k = s.locationKey ?? ''; (byLocation.get(k) ?? byLocation.set(k, []).get(k)!).push(s) }
      voters.set(monitorId, [...byLocation.values()].map((list) => voterSets(list, interval, cover, ctx.excludeMaintenance)))
    }
  }

  const incidents = await reader.incidents(tenantId, new Date(interval.start), new Date(interval.end))
  const rows: SlaRow[] = []
  for (const g of groups) {
    const ids = new Set(g.monitorIds)
    const count = incidents.filter((i) => (i.monitorId !== null && ids.has(i.monitorId)) || (g.componentId !== null && (i.affectedComponentIds ?? []).includes(g.componentId))).length
    rows.push(computeSlaRow({
      key: g.key, name: g.name, monitorCount: g.monitorIds.length, period: interval,
      samples: g.monitorIds.length ? await reader.rollup(tenantId, g.monitorIds, period.fromDay, period.toDay) : null,
      timeline: timelineOk ? combineVoters(g.monitorIds.flatMap((id) => voters.get(id) ?? []), interval) : null,
      timelineReason: timelineOk ? undefined : timelineReason, incidents: count, objectivePercent: g.objectivePercent,
    }))
  }

  return {
    scope,
    period: { from: period.fromDay, to: period.toDay, start: new Date(interval.start).toISOString(), end: new Date(interval.end).toISOString(), days: period.days },
    generatedAt: now.toISOString(), maintenanceExcluded: ctx.excludeMaintenance, rawRetentionDays: ctx.retentionDays, rows, notes: [...REPORT_NOTES],
  }
}
