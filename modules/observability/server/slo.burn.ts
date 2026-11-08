import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheck } from './entities/monitor_check.entity'
import type { Slo } from './entities/slo.entity'
import { budgetStatus, burnRate, type Counts } from './slo.budget'
import { evaluateSlo, loadContext, utcDay, type SloReport } from './slo.service'
import { dbSliReader, resolveMonitorIds, type SliReader } from './slo.sli'
export { BURN_POINTS_MIN, BURN_POINTS_MAX, BURN_POINTS_DEFAULT } from './slo.dto'

/**
 * The data behind the burn chart of an SLO (observability phase 13.5): a series over the SLO window of the burn rate and of the error budget
 * that is left, plus, per tier, the current short and long window burn. It is computed with the SAME pure budget math the tier evaluation uses
 * (`slo.budget.ts`) and the SAME evaluator for the scalars (`evaluateSlo`), so a number on the chart is the number the alert saw.
 *
 * Resolution, stated per point and never guessed at:
 *  - `day`    a UTC day from the daily ROLLUP (it survives raw-check retention, so this is the only source for old days). The current day, and
 *             the part of a day that precedes the hourly region, are shorter than a day; `from` / `to` say exactly what a point covers.
 *  - `hour`   one hour from RAW checks, for the most recent hours, only where raw checks still exist (never older than the retention window).
 *  - `merged` several days or hours folded into one point to honour the `points` bound (a 90-day window with `points=30` cannot show 90 days).
 *
 * Semantics:
 *  - `burn` is the burn rate of the events inside that point alone (1 = exactly on budget); `null` when the point holds no events: no data is
 *    never zero.
 *  - `budgetRemaining` is the share of the budget left after ALL events from the start of the window up to the end of the point (the budget math
 *    of `budgetStatus`: it judges the events seen so far, it does not extrapolate an unmeasured part of the window). It carries forward across a
 *    point with no events and is `null` only until the first event.
 *  - The objective is the SLO's CURRENT one, applied to the whole window: history is not versioned, so a changed objective redraws the entire
 *    series (the same thing the evaluation does).
 *  - Boundaries: a raw point covers [from, to) so a sample is counted once; the tier windows read [now - h, now], and only a sample exactly on
 *    a boundary can differ.
 *  - Maintenance is left out exactly as the rollup and the tier windows leave it out (`observabilityExcludeMaintenanceFromUptime`).
 *  - Metric SLOs (ROOT only, `METRIC_RATIO`) have no history to draw (the metric source answers whole windows), so their series is empty.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** How far back the hourly region reaches at most (when raw checks and the point bound allow it). */
export const BURN_HOURLY_HORIZON_HOURS = 48

export type BurnResolution = 'day' | 'hour' | 'merged'
export type BurnSource = 'rollup' | 'raw'

export interface BurnPoint {
  from: string
  to: string
  spanMinutes: number
  resolution: BurnResolution
  source: BurnSource
  counts: Counts
  sli: number | null
  burn: number | null
  budgetRemaining: number | null
}

export interface BurnTierNow {
  id: string
  action: string
  thresholdBurnRate: number
  longHours: number
  shortHours: number
  longBurn: number | null
  shortBurn: number | null
  firing: boolean
}

export interface BurnSeries {
  sloId: string
  kind: string
  objectivePercent: number
  windowDays: number
  effectiveWindowDays: number
  limitedByRetention: boolean
  windowStart: string
  generatedAt: string
  pointsRequested: number
  /** Which resolutions the points use, by source. */
  resolutions: { rollup: Array<'day' | 'merged'>; raw: Array<'hour' | 'merged' | 'day'> }
  points: BurnPoint[]
  current: {
    budgetRemaining: number | null
    state: string
    currentBurn: number | null
    projectedExhaustionDays: number | null
    tiers: BurnTierNow[]
  }
  notes: string[]
}

// ---- the reader ---------------------------------------------------------------------------------------------------------------------

export type BucketSpec = { kind: 'availability' } | { kind: 'latency'; thresholdMs: number }

/** The SLI reader plus the one extra read the chart needs: raw checks folded into consecutive buckets in one aggregate query. */
export interface BurnReader extends SliReader {
  /**
   * Counts per bucket of `bucketMs` for raw samples in [from, to), index 0 being the NEWEST bucket (the one that ends at `to`). The number of
   * buckets is `ceil((to - from) / bucketMs)`; the oldest bucket is clipped at `from`.
   */
  rawBuckets(tenantId: string, monitorIds: readonly string[], from: Date, to: Date, bucketMs: number, spec: BucketSpec, excludeMaintenance: boolean): Promise<Counts[]>
}

export const dbBurnReader: BurnReader = {
  ...dbSliReader,
  async rawBuckets(tenantId, monitorIds, from, to, bucketMs, spec, excludeMaintenance) {
    const n = Math.max(0, Math.ceil((to.getTime() - from.getTime()) / bucketMs))
    const out: Counts[] = Array.from({ length: n }, () => ({ good: 0, total: 0 }))
    if (n === 0 || monitorIds.length === 0) return out
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) => {
      const qb = repo.createQueryBuilder('c')
        // (to - checkedAt) in whole milliseconds u: a sample in [to - (k+1) b, to - k b) has u in (k b, (k+1) b], so its index is floor((u - 1) / b).
        .select('FLOOR((EXTRACT(EPOCH FROM (CAST(:to AS timestamptz) - c.checkedAt)) * 1000 - 1) / :bucketMs)', 'idx')
        .where('c.tenantId = :tenantId', { tenantId })
        .andWhere('c.monitorId IN (:...monitorIds)', { monitorIds })
        .andWhere('c.checkedAt >= :from AND c.checkedAt < :to', { from, to })
        .setParameter('bucketMs', bucketMs)
        .groupBy('idx')
      if (spec.kind === 'latency') {
        qb.addSelect(`COUNT(*) FILTER (WHERE c.status IN ('UP','DEGRADED') AND c.latencyMs IS NOT NULL AND c.latencyMs <= :threshold)`, 'good')
          .setParameter('threshold', spec.thresholdMs)
      } else {
        qb.addSelect(`COUNT(*) FILTER (WHERE c.status IN ('UP','DEGRADED'))`, 'good')
      }
      qb.addSelect(`COUNT(*) FILTER (WHERE c.status IN ('UP','DEGRADED','DOWN'))`, 'total')
      if (excludeMaintenance) qb.andWhere('c.duringMaintenance = false')
      return qb.getRawMany<{ idx: string; good: string; total: string }>()
    })
    for (const r of rows) {
      const i = Math.trunc(Number(r.idx))
      if (i >= 0 && i < n) out[i] = { good: parseInt(r.good, 10), total: parseInt(r.total, 10) }
    }
    return out
  },
}

// ---- the plan (pure) ---------------------------------------------------------------------------------------------------------------

export interface BucketPlan {
  from: Date
  to: Date
  source: BurnSource
  resolution: BurnResolution
  /** Rollup buckets: the UTC days they cover. */
  days?: string[]
}

export interface BurnPlan {
  buckets: BucketPlan[]
  /** The raw reads the buckets need, newest bucket first within each. */
  hourly: { from: Date; to: Date } | null
  straddle: { from: Date; to: Date } | null
  latency: { from: Date; to: Date; bucketMs: number } | null
}

const midnight = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const dayString = (d: Date): string => d.toISOString().slice(0, 10)

/** Merge `items` (oldest first) into at most `max` consecutive groups of equal size (the newest group may be smaller). */
function groupBy<T>(items: T[], max: number): T[][] {
  const size = Math.max(1, Math.ceil(items.length / max))
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size))
  return groups
}

/** The days of the window that precede `dailyEnd`, one rollup bucket each (the last one clipped at `clipEnd`). */
function dailyBuckets(windowStartDay: string, dailyEnd: Date): BucketPlan[] {
  const out: BucketPlan[] = []
  for (let start = new Date(`${windowStartDay}T00:00:00.000Z`); start < dailyEnd; start = new Date(start.getTime() + DAY_MS)) {
    out.push({ from: start, to: new Date(Math.min(start.getTime() + DAY_MS, dailyEnd.getTime())), source: 'rollup', resolution: 'day', days: [dayString(start)] })
  }
  return out
}

function mergeRollup(buckets: BucketPlan[], max: number): BucketPlan[] {
  if (buckets.length <= max) return buckets
  return groupBy(buckets, max).map((g) => ({
    from: g[0].from, to: g[g.length - 1].to, source: 'rollup' as const,
    resolution: g.length === 1 ? g[0].resolution : 'merged' as const, days: g.flatMap((b) => b.days ?? []),
  }))
}

/**
 * Where the points of an availability chart come from. The newest `H` hours are hourly (raw), the rest is daily (rollup); `H` is the largest value
 * (up to 48, never beyond raw retention) for which the whole plan fits in `points` with every day kept whole; when even one hour does not fit,
 * there is no hourly region and the days are merged to fit. Hourly points are aligned to `now`, so the newest one is
 * exactly the fast tier's one-hour window.
 */
export function planAvailability(now: Date, windowDays: number, retentionDays: number, points: number): BurnPlan {
  const windowStartDay = utcDay(new Date(now.getTime() - (windowDays - 1) * DAY_MS))
  const rawFloor = now.getTime() - retentionDays * DAY_MS
  const hmax = Math.min(BURN_HOURLY_HORIZON_HOURS, retentionDays * 24)
  for (let h = hmax; h >= 1; h--) {
    const candidate = new Date(now.getTime() - h * HOUR_MS)
    let hourlyStart = candidate
    let straddle: BurnPlan['straddle'] = null
    let dailyEnd: Date
    if (midnight(candidate).getTime() >= rawFloor) {
      dailyEnd = midnight(candidate)
      if (candidate > dailyEnd) straddle = { from: dailyEnd, to: candidate }
    } else {
      // The partial day before the horizon is older than raw retention: start the hourly region on the next midnight instead.
      dailyEnd = new Date(midnight(candidate).getTime() + DAY_MS)
      hourlyStart = dailyEnd
      if (hourlyStart >= now) continue
    }
    const hourlyCount = Math.ceil((now.getTime() - hourlyStart.getTime()) / HOUR_MS)
    const rollup = dailyBuckets(windowStartDay, dailyEnd)
    const fixed = hourlyCount + (straddle ? 1 : 0)
    // Daily resolution wins over hourly depth: the hourly region is only as deep as the days can stay whole next to it.
    if (fixed + rollup.length > points) continue
    const buckets: BucketPlan[] = [...rollup]
    if (straddle) buckets.push({ from: straddle.from, to: straddle.to, source: 'raw', resolution: 'day' })
    for (let i = hourlyCount - 1; i >= 0; i--) {
      buckets.push({ from: new Date(Math.max(hourlyStart.getTime(), now.getTime() - (i + 1) * HOUR_MS)), to: new Date(now.getTime() - i * HOUR_MS), source: 'raw', resolution: 'hour' })
    }
    return { buckets, hourly: { from: hourlyStart, to: now }, straddle, latency: null }
  }
  // No hourly region (raw retention too short, or no room for it): daily points up to now, merged to fit.
  const rollup = dailyBuckets(windowStartDay, now)
  return { buckets: mergeRollup(rollup, points), hourly: null, straddle: null, latency: null }
}

/** Latency has no rollup, so every point is raw, folded into buckets of a whole number of hours so there are at most `points` of them. */
export function planLatency(now: Date, effectiveWindowDays: number, points: number): BurnPlan {
  const from = new Date(now.getTime() - effectiveWindowDays * DAY_MS)
  const hours = Math.ceil((now.getTime() - from.getTime()) / HOUR_MS)
  const bucketHours = Math.max(1, Math.ceil(hours / points))
  const bucketMs = bucketHours * HOUR_MS
  const n = Math.ceil((now.getTime() - from.getTime()) / bucketMs)
  const buckets: BucketPlan[] = []
  for (let i = n - 1; i >= 0; i--) {
    buckets.push({ from: new Date(Math.max(from.getTime(), now.getTime() - (i + 1) * bucketMs)), to: new Date(now.getTime() - i * bucketMs), source: 'raw', resolution: bucketHours === 1 ? 'hour' : 'merged' })
  }
  return { buckets, hourly: null, straddle: null, latency: { from, to: now, bucketMs } }
}

// ---- the series (pure given the counts) ---------------------------------------------------------------------------------------------

const finiteOrNull = (x: number | null): number | null => (x !== null && Number.isFinite(x) ? x : null)

/** Turn counted buckets into points: per-point burn, cumulative budget. Pure: the whole chart's arithmetic is here. */
export function assemblePoints(buckets: BucketPlan[], counts: Counts[], objectivePercent: number, lowBelowPercent: number): BurnPoint[] {
  let cum: Counts = { good: 0, total: 0 }
  return buckets.map((b, i) => {
    const c = counts[i] ?? { good: 0, total: 0 }
    cum = { good: cum.good + c.good, total: cum.total + c.total }
    const budget = budgetStatus(cum, objectivePercent, lowBelowPercent)
    return {
      from: b.from.toISOString(), to: b.to.toISOString(), spanMinutes: Math.round((b.to.getTime() - b.from.getTime()) / 60_000),
      resolution: b.resolution, source: b.source, counts: c,
      sli: c.total > 0 ? c.good / c.total : null,
      burn: finiteOrNull(burnRate(c, objectivePercent)),
      budgetRemaining: finiteOrNull(budget.remainingFraction),
    }
  })
}

function sum(list: Counts[]): Counts { return list.reduce((a, c) => ({ good: a.good + c.good, total: a.total + c.total }), { good: 0, total: 0 }) }

/** The burn series of one SLO, with the current scalars of its report. */
export async function buildBurnSeries(tenantId: string, slo: Slo, points: number, reader: BurnReader = dbBurnReader, now: Date = new Date()): Promise<BurnSeries> {
  const ctx = await loadContext(tenantId, reader, now)
  const report: SloReport = await evaluateSlo(tenantId, slo, ctx)
  const objective = Number(slo.objectivePercent)
  const notes: string[] = []
  let buckets: BucketPlan[] = []
  let counts: Counts[] = []

  if (slo.kind === 'METRIC_RATIO') {
    notes.push('A metric SLO reads whole windows from the metric source: there is no history to draw, only the current values.')
  } else {
    const monitorIds = await resolveMonitorIds(tenantId, slo)
    if (slo.kind === 'MONITOR_LATENCY') {
      const plan = planLatency(now, report.effectiveWindowDays, points)
      buckets = plan.buckets
      counts = (await reader.rawBuckets(tenantId, monitorIds, plan.latency!.from, plan.latency!.to, plan.latency!.bucketMs, { kind: 'latency', thresholdMs: slo.latencyThresholdMs ?? 0 }, ctx.excludeMaintenance)).slice().reverse()
      if (report.limitedByRetention) notes.push(`Latency is not kept in the daily rollup, so the chart covers the last ${report.effectiveWindowDays} days (raw retention), not the ${slo.windowDays}-day window.`)
    } else {
      const plan = planAvailability(now, slo.windowDays, ctx.retentionDays, points)
      buckets = plan.buckets
      const windowStartDay = utcDay(new Date(now.getTime() - (slo.windowDays - 1) * DAY_MS))
      const daily = new Map((await reader.dailySeries(tenantId, monitorIds, windowStartDay)).map((d) => [d.day, { good: d.good, total: d.total }]))
      const hourly = plan.hourly ? (await reader.rawBuckets(tenantId, monitorIds, plan.hourly.from, plan.hourly.to, HOUR_MS, { kind: 'availability' }, ctx.excludeMaintenance)).slice().reverse() : []
      const straddle = plan.straddle ? (await reader.rawBuckets(tenantId, monitorIds, plan.straddle.from, plan.straddle.to, plan.straddle.to.getTime() - plan.straddle.from.getTime(), { kind: 'availability' }, ctx.excludeMaintenance))[0] : null
      let hourlyIndex = 0
      counts = buckets.map((b) => {
        if (b.source === 'rollup') return sum((b.days ?? []).map((d) => daily.get(d) ?? { good: 0, total: 0 }))
        if (b.resolution === 'day') return straddle ?? { good: 0, total: 0 }
        return hourly[hourlyIndex++] ?? { good: 0, total: 0 }
      })
      if (!plan.hourly) notes.push('Raw checks are not kept long enough for an hourly region: every point is a day (or several) from the rollup.')
    }
  }

  const series = assemblePoints(buckets, counts, objective, slo.lowBudgetPercent)
  const rollupRes = [...new Set(series.filter((p) => p.source === 'rollup').map((p) => p.resolution))] as Array<'day' | 'merged'>
  const rawRes = [...new Set(series.filter((p) => p.source === 'raw').map((p) => p.resolution))] as Array<'hour' | 'merged' | 'day'>
  return {
    sloId: slo.sloId, kind: slo.kind, objectivePercent: objective, windowDays: slo.windowDays,
    effectiveWindowDays: report.effectiveWindowDays, limitedByRetention: report.limitedByRetention,
    windowStart: new Date(now.getTime() - (slo.windowDays - 1) * DAY_MS).toISOString().slice(0, 10), generatedAt: now.toISOString(), pointsRequested: points,
    resolutions: { rollup: rollupRes, raw: rawRes },
    points: series,
    current: {
      budgetRemaining: finiteOrNull(report.budget.remainingFraction), state: report.budget.state,
      currentBurn: finiteOrNull(report.currentBurn), projectedExhaustionDays: report.projectedExhaustionDays,
      tiers: report.tiers.map((t) => ({ id: t.id, action: t.action, thresholdBurnRate: t.thresholdBurnRate, longHours: t.longHours, shortHours: t.shortHours, longBurn: finiteOrNull(t.longBurn), shortBurn: finiteOrNull(t.shortBurn), firing: t.firing })),
    },
    notes,
  }
}
