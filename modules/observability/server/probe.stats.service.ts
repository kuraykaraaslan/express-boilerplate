import 'reflect-metadata'
import { MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheck } from './entities/monitor_check.entity'
import { MonitorCheckDailyLocation } from './entities/monitor_check_daily_location.entity'
import { aggregateOf, averageMs, mergeAggregates, p95Of, type LatencyAggregate } from './uptime.latency-buckets'
import MonitorService from './uptime.monitor.service'
import { LOCAL_LOCATION, combineLocations, type LocationStates, type QuorumVerdict } from './probe.quorum'

/**
 * Uptime and latency PER LOCATION for one monitor (observability phase 10.5), plus the monitor's current quorum verdict.
 *
 * Two windows, one response shape:
 *  - the RAW window (`forMonitor`, up to 90 days): from the raw checks inside their retention window, exactly as before;
 *  - the LONG window (`forMonitorLong`, up to 365 days): from `monitor_check_daily_location`, the additive per-location rollup (decision D-OBS-12),
 *    which survives raw-check retention. That table has NO backfill: history written before it existed is monitor-level only, so a long report says
 *    plainly on which day per-location data starts (`perLocation`) instead of presenting a shorter history as a full window.
 */
export interface LocationStat {
  locationKey: string
  samples: number
  up: number
  degraded: number
  down: number
  unknown: number
  uptimePercent: number | null
  avgLatencyMs: number | null
  /** The location's current debounced state, when the monitor keeps one (two or more locations). */
  state: { status: string; at: string; error: string | null } | null
}

/** What the long window knows about where its per-location data starts. */
export interface PerLocationCoverage {
  /** First UTC day (YYYY-MM-DD) with any per-location data for this monitor, ever; null when none has been recorded. */
  from: string | null
  /** First UTC day of the requested window. */
  windowFrom: string
  /** True when per-location data covers the whole window. When false, the figures describe only `from` onward. */
  coversWindow: boolean
  note: string
}

export interface LongLocationStat extends LocationStat {
  /** Approximate p95 (upper edge of a fixed bucket, never below the true value: see `uptime.latency-buckets.ts`); null with no latency samples. */
  p95LatencyMs: number | null
  /** True when the p95 is above the last bucket edge, so the figure is a floor. */
  p95Capped: boolean
  /** First day of this location's data inside the window. */
  from: string | null
}

export interface MonitorLocationReport {
  days: number
  locations: LocationStat[]
  verdict: QuorumVerdict | null
  /** `raw` (the raw checks, up to 90 days) or `long` (the per-location rollup, up to 365). */
  window?: 'raw' | 'long'
  /** Long window only. */
  source?: 'rollup'
  perLocation?: PerLocationCoverage
}
export interface LongMonitorLocationReport extends MonitorLocationReport {
  window: 'long'
  source: 'rollup'
  perLocation: PerLocationCoverage
  locations: LongLocationStat[]
}

export const MAX_RAW_DAYS = 90
export const MAX_LONG_DAYS = 365

const DAY_MS = 86_400_000
const dayOf = (d: Date) => d.toISOString().slice(0, 10)
const toIso = (v: unknown) => String(v).slice(0, 10)

export default class ProbeStatsService {
  static async forMonitor(tenantId: string, monitorId: string, days: number, now: Date = new Date()): Promise<MonitorLocationReport> {
    const monitor = await MonitorService.getById(tenantId, monitorId)
    const since = new Date(now.getTime() - days * 86_400_000)
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => repo.createQueryBuilder('c')
      .select(`COALESCE(c."locationKey", '${LOCAL_LOCATION}')`, 'locationKey')
      .addSelect('c.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(c."latencyMs")', 'avgLatency')
      .where('c.tenantId = :tenantId', { tenantId }).andWhere('c.monitorId = :monitorId', { monitorId })
      .andWhere('c.checkedAt >= :since', { since })
      .groupBy(`COALESCE(c."locationKey", '${LOCAL_LOCATION}')`).addGroupBy('c.status')
      .getRawMany<{ locationKey: string; status: string; count: string; avgLatency: string | null }>())

    const states = (monitor.locationState ?? {}) as LocationStates
    const byKey = new Map<string, LocationStat & { latSum: number; latN: number }>()
    const get = (key: string) => {
      let s = byKey.get(key)
      if (!s) { s = { locationKey: key, samples: 0, up: 0, degraded: 0, down: 0, unknown: 0, uptimePercent: null, avgLatencyMs: null, state: null, latSum: 0, latN: 0 }; byKey.set(key, s) }
      return s
    }
    for (const r of rows) {
      const s = get(r.locationKey)
      const n = Number(r.count)
      if (r.status === 'UP') s.up += n; else if (r.status === 'DEGRADED') s.degraded += n; else if (r.status === 'DOWN') s.down += n; else s.unknown += n
      if (r.avgLatency != null && r.status !== 'DOWN') { s.latSum += Number(r.avgLatency) * n; s.latN += n }
    }
    // every configured location is listed, even one that has not reported yet
    for (const key of monitor.locations ?? []) get(key)
    for (const [key, st] of Object.entries(states)) if (byKey.has(key)) byKey.get(key)!.state = { status: st.status, at: st.at, error: st.error ?? null }

    const locations = [...byKey.values()].map(({ latSum, latN, ...s }) => {
      const judged = s.up + s.degraded + s.down
      return { ...s, uptimePercent: judged ? Math.round(((s.up + s.degraded) / judged) * 10000) / 100 : null, avgLatencyMs: latN ? Math.round(latSum / latN) : null }
    }).sort((a, b) => a.locationKey.localeCompare(b.locationKey))

    const configured = monitor.locations ?? []
    const verdict = configured.length > 1 ? combineLocations(states, configured, { quorum: monitor.quorum, now, intervalSeconds: monitor.intervalSeconds }) : null
    return { days, locations, verdict, window: 'raw' }
  }

  /**
   * The long window (up to 365 days) from the per-location rollup. DEGRADED counts as available (the same rule as every uptime figure), and a
   * sample taken during planned maintenance is simply absent from the table when the tenant excludes maintenance (it is excluded at write time by
   * the same call that writes the monitor-level rollup), so these percentages follow the same maintenance rule as the monitor-level ones.
   * A location with no samples in the window reports `uptimePercent: null`, never 100: an unmeasured window is not a good one.
   */
  static async forMonitorLong(tenantId: string, monitorId: string, days: number, now: Date = new Date()): Promise<LongMonitorLocationReport> {
    const monitor = await MonitorService.getById(tenantId, monitorId)
    const windowFrom = dayOf(new Date(now.getTime() - (days - 1) * DAY_MS))
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDailyLocation, (repo) => repo.find({
      where: { tenantId, monitorId, day: MoreThanOrEqual(windowFrom) }, order: { day: 'ASC' },
    }))
    const earliest = await withTenantRepositoryFor(tenantId, MonitorCheckDailyLocation, (repo) => repo.find({
      where: { tenantId, monitorId }, order: { day: 'ASC' }, take: 1,
    }))
    const from = earliest[0] ? toIso(earliest[0].day) : null

    const states = (monitor.locationState ?? {}) as LocationStates
    type Acc = { up: number; degraded: number; down: number; first: string | null; latency: LatencyAggregate[] }
    const byKey = new Map<string, Acc>()
    const get = (key: string) => {
      let a = byKey.get(key)
      if (!a) { a = { up: 0, degraded: 0, down: 0, first: null, latency: [] }; byKey.set(key, a) }
      return a
    }
    for (const r of rows) {
      const a = get(r.locationKey)
      a.up += r.up; a.degraded += r.degraded; a.down += r.down
      const day = toIso(r.day)
      if (a.first === null || day < a.first) a.first = day
      a.latency.push(aggregateOf(r))
    }
    for (const key of monitor.locations ?? []) get(key)

    const locations = [...byKey.entries()].map(([locationKey, a]): LongLocationStat => {
      const judged = a.up + a.degraded + a.down
      const merged = mergeAggregates(a.latency)
      const p95 = p95Of(merged)
      const st = states[locationKey]
      return {
        locationKey, samples: judged, up: a.up, degraded: a.degraded, down: a.down, unknown: 0,
        uptimePercent: judged ? Math.round(((a.up + a.degraded) / judged) * 10000) / 100 : null,
        avgLatencyMs: averageMs(merged), p95LatencyMs: p95?.ms ?? null, p95Capped: p95?.capped ?? false, from: a.first,
        state: st ? { status: st.status, at: st.at, error: st.error ?? null } : null,
      }
    }).sort((x, y) => x.locationKey.localeCompare(y.locationKey))

    const coversWindow = from !== null && from <= windowFrom
    const note = from === null
      ? 'No per-location data has been recorded yet; history written before the per-location rollup existed is monitor-level only.'
      : coversWindow
        ? `Per-location data covers the whole window (it starts on ${from}).`
        : `Per-location data starts on ${from}; the part of this window before that day is monitor-level only and is not included in these figures.`
    const configured = monitor.locations ?? []
    const verdict = configured.length > 1 ? combineLocations(states, configured, { quorum: monitor.quorum, now, intervalSeconds: monitor.intervalSeconds }) : null
    return { days, window: 'long', source: 'rollup', locations, verdict, perLocation: { from, windowFrom, coversWindow, note } }
  }
}
