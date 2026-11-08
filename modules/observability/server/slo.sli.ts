import 'reflect-metadata'
import { In, MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheck } from './entities/monitor_check.entity'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import type { Counts } from './slo.budget'

/**
 * Where an SLO's events come from (observability phase 13). Three reads, behind one interface so the evaluator is pure and tested with an
 * in-memory reader, and the production reader is aggregate SQL (a 3-day window over ten monitors is tens of thousands of rows, which must
 * never be pulled into memory once a minute).
 *
 *  - `availability`: raw samples in a time range. Up and degraded are good, down is bad, an inconclusive sample is not an event at all.
 *    Samples taken during planned maintenance are left out when the tenant keeps maintenance out of uptime (the same rule the daily rollup
 *    applied when it was written, so the two numbers cannot disagree).
 *  - `availabilityDaily`: the daily rollup, which survives raw-check retention. This is what a 30- or 90-day window reads.
 *  - `latency`: raw samples again: good means up (not down) AND answered within the threshold. Latency is not in the rollup, so a latency SLO
 *    can only look back as far as raw retention (the service reports that, it does not pretend).
 */
export interface SliReader {
  availability(tenantId: string, monitorIds: readonly string[], from: Date, to: Date, excludeMaintenance: boolean): Promise<Counts>
  availabilityDaily(tenantId: string, monitorIds: readonly string[], sinceDay: string): Promise<Counts>
  latency(tenantId: string, monitorIds: readonly string[], from: Date, to: Date, thresholdMs: number, excludeMaintenance: boolean): Promise<Counts>
  dailySeries(tenantId: string, monitorIds: readonly string[], sinceDay: string): Promise<Array<{ day: string; good: number; total: number }>>
}

/** The monitors an SLO measures: the component's, when it names one, otherwise the listed ones. */
export async function resolveMonitorIds(tenantId: string, slo: { componentId?: string | null; monitorIds?: string[] }): Promise<string[]> {
  if (slo.componentId) {
    const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) => repo.find({ where: { tenantId, componentId: slo.componentId as string } }))
    return links.map((l) => l.monitorId)
  }
  return [...(slo.monitorIds ?? [])]
}

export const dbSliReader: SliReader = {
  async availability(tenantId, monitorIds, from, to, excludeMaintenance) {
    if (monitorIds.length === 0) return { good: 0, total: 0 }
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => {
      const qb = repo.createQueryBuilder('c')
        .select('c.status', 'status').addSelect('COUNT(*)', 'count')
        .where('c.tenantId = :tenantId', { tenantId })
        .andWhere('c.monitorId IN (:...monitorIds)', { monitorIds })
        .andWhere('c.checkedAt >= :from AND c.checkedAt <= :to', { from, to })
      if (excludeMaintenance) qb.andWhere('c.duringMaintenance = false')
      return qb.groupBy('c.status').getRawMany<{ status: string; count: string }>()
    })
    let good = 0; let total = 0
    for (const r of rows) {
      const n = parseInt(r.count, 10)
      if (r.status === 'UP' || r.status === 'DEGRADED') { good += n; total += n } else if (r.status === 'DOWN') total += n
    }
    return { good, total }
  },

  async availabilityDaily(tenantId, monitorIds, sinceDay) {
    if (monitorIds.length === 0) return { good: 0, total: 0 }
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) => repo.find({ where: { tenantId, monitorId: In([...monitorIds]), day: MoreThanOrEqual(sinceDay) } }))
    return rows.reduce<Counts>((acc, r) => ({ good: acc.good + r.up + r.degraded, total: acc.total + r.up + r.degraded + r.down }), { good: 0, total: 0 })
  },

  async latency(tenantId, monitorIds, from, to, thresholdMs, excludeMaintenance) {
    if (monitorIds.length === 0) return { good: 0, total: 0 }
    const row = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => {
      const qb = repo.createQueryBuilder('c')
        .select(`COUNT(*) FILTER (WHERE c.status IN ('UP','DEGRADED') AND c.latencyMs IS NOT NULL AND c.latencyMs <= :threshold)`, 'good')
        .addSelect(`COUNT(*) FILTER (WHERE c.status IN ('UP','DEGRADED','DOWN'))`, 'total')
        .where('c.tenantId = :tenantId', { tenantId })
        .andWhere('c.monitorId IN (:...monitorIds)', { monitorIds })
        .andWhere('c.checkedAt >= :from AND c.checkedAt <= :to', { from, to })
        .setParameter('threshold', thresholdMs)
      if (excludeMaintenance) qb.andWhere('c.duringMaintenance = false')
      return qb.getRawOne<{ good: string; total: string }>()
    })
    return { good: parseInt(row?.good ?? '0', 10), total: parseInt(row?.total ?? '0', 10) }
  },

  async dailySeries(tenantId, monitorIds, sinceDay) {
    if (monitorIds.length === 0) return []
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) => repo.find({ where: { tenantId, monitorId: In([...monitorIds]), day: MoreThanOrEqual(sinceDay) } }))
    const byDay = new Map<string, { good: number; total: number }>()
    for (const r of rows) {
      const cur = byDay.get(r.day) ?? { good: 0, total: 0 }
      cur.good += r.up + r.degraded; cur.total += r.up + r.degraded + r.down
      byDay.set(r.day, cur)
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v }))
  },
}

/**
 * The metrics side of `METRIC_RATIO` (platform plane). A source answers "how many good and how many total events in the last N seconds"
 * for two query strings. There is deliberately no default: the SLO says NO_DATA until a backend is wired (phase 17 provides one over the
 * telemetry port), so a missing backend can never read as "100 % good".
 */
export interface MetricSliSource {
  ratio(spec: { goodQuery: string; totalQuery: string }, windowSeconds: number, at: Date): Promise<Counts | null>
}

let metricSource: MetricSliSource | null = null
export function setMetricSliSource(source: MetricSliSource | null): void { metricSource = source }
export function getMetricSliSource(): MetricSliSource | null { return metricSource }
