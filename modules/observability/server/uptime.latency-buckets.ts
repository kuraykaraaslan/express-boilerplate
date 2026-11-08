/**
 * Latency aggregates of the daily rollups (observability phase 15.6, the response-time chart), pure.
 *
 * Raw checks age out under retention and the rollup used to hold only up/degraded/down counters, so a response-time chart could not exist beyond
 * the raw window. Each rollup row now also carries, for the samples that measured a latency (UP and DEGRADED ones; a DOWN sample's time is a
 * timeout or a refusal, not a response time):
 *
 *   - `latencyCount`  how many samples measured one,
 *   - `latencySumMs`  the sum of those latencies in whole milliseconds,
 *   - `latencyBuckets` one counter per FIXED bucket (the edges below), incremented in the same atomic UPSERT as the up/degraded/down counter.
 *
 * What is exact and what is approximate.
 *   - The AVERAGE is exact: `latencySumMs / latencyCount` (the sum and the count are additive across days, monitors and locations).
 *   - The p95 is an APPROXIMATION from the buckets: the reported value is the UPPER EDGE of the bucket that holds the 95th-percentile sample.
 *     The true p95 therefore lies in (lowerEdge, upperEdge]: the estimate is never below the truth and over-states it by less than one bucket
 *     width. With the edges below that is at most 25 ms below 100 ms and at most 50 % of the true value above it (every bucket's upper edge
 *     is at most 1.5 times its lower edge from 100 ms up; 200-300 ms, 500-750 ms, 1000-1500 ms and so on are the widest). A p95 above the last edge (30 s) is reported as that edge and flagged `capped`.
 *   - Merging days, monitors or locations adds bucket counters, so the same bound holds for any window (it is a bound on the bucket, not on a day).
 *
 * The edges are part of the stored data: a counter's meaning is "samples whose latency fell in bucket i". Changing an edge would silently
 * change the meaning of history, so the array is frozen here and a test pins it.
 */

/** Upper edges in ms, inclusive. A sample of exactly 50 ms is in bucket 1 (26..50). */
export const LATENCY_BUCKET_EDGES_MS: readonly number[] = Object.freeze([
  25, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000,
])
/** One counter per edge plus the overflow bucket (> 30 s). */
export const LATENCY_BUCKET_COUNT = LATENCY_BUCKET_EDGES_MS.length + 1

/** A fresh all-zero bucket array (what the column defaults to). */
export const emptyBuckets = (): number[] => new Array<number>(LATENCY_BUCKET_COUNT).fill(0)

/** The bucket a latency falls in. Negative and non-finite values are not latencies: null. */
export function bucketIndex(latencyMs: number): number | null {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return null
  for (let i = 0; i < LATENCY_BUCKET_EDGES_MS.length; i++) if (latencyMs <= LATENCY_BUCKET_EDGES_MS[i]) return i
  return LATENCY_BUCKET_COUNT - 1
}

/** The 1-based array position used by the SQL UPSERT (Postgres arrays start at 1). */
export const sqlBucketPosition = (index: number): number => index + 1

/** The DEFAULT of the `latencyBuckets` column, spelled once so the entity, the migration and the test agree. */
export const BUCKETS_DEFAULT_SQL = `'{${emptyBuckets().join(',')}}'`

export interface LatencyAggregate {
  count: number
  sumMs: number
  buckets: readonly number[]
}

export const emptyAggregate = (): LatencyAggregate => ({ count: 0, sumMs: 0, buckets: emptyBuckets() })

/** Normalise what a row hands back (a bigint arrives as a string, a missing array as null) into numbers. */
export function aggregateOf(row: { latencyCount?: number | string | null; latencySumMs?: number | string | null; latencyBuckets?: readonly (number | string)[] | null }): LatencyAggregate {
  const buckets = emptyBuckets()
  const raw = row.latencyBuckets ?? []
  for (let i = 0; i < buckets.length && i < raw.length; i++) buckets[i] = Number(raw[i]) || 0
  return { count: Number(row.latencyCount ?? 0) || 0, sumMs: Number(row.latencySumMs ?? 0) || 0, buckets }
}

export function mergeAggregates(list: readonly LatencyAggregate[]): LatencyAggregate {
  const out = emptyAggregate()
  const buckets = out.buckets as number[]
  for (const a of list) {
    out.count += a.count
    out.sumMs += a.sumMs
    for (let i = 0; i < buckets.length; i++) buckets[i] += a.buckets[i] ?? 0
  }
  return out
}

/** Exact average in whole ms, or null when no sample measured a latency. */
export function averageMs(a: LatencyAggregate): number | null {
  return a.count > 0 ? Math.round(a.sumMs / a.count) : null
}

export interface P95 { ms: number; /** True when the 95th percentile is above the last edge: `ms` is that edge, a floor rather than an estimate. */ capped: boolean }

/** The approximate p95 (upper edge of the bucket holding the 95th-percentile sample), or null with no samples. See the file header for the bound. */
export function p95Of(a: LatencyAggregate): P95 | null {
  const total = a.buckets.reduce((s, n) => s + n, 0)
  if (total === 0) return null
  const rank = Math.ceil(total * 0.95)
  let seen = 0
  for (let i = 0; i < a.buckets.length; i++) {
    seen += a.buckets[i]
    if (seen >= rank) {
      return i < LATENCY_BUCKET_EDGES_MS.length ? { ms: LATENCY_BUCKET_EDGES_MS[i], capped: false } : { ms: LATENCY_BUCKET_EDGES_MS[LATENCY_BUCKET_EDGES_MS.length - 1], capped: true }
    }
  }
  return null
}

export interface DayLatency {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string
  /** Exact average; null when the day measured no latency. */
  avgMs: number | null
  /** Approximate p95 (see the file header); null when the day measured no latency. */
  p95Ms: number | null
}

export interface LatencySeries {
  /** Always true: the p95 is read from fixed buckets. The average is exact. */
  p95Approximate: true
  days: DayLatency[]
  /** Over the whole window. */
  avgMs: number | null
  p95Ms: number | null
}

/** One bar per day of `days` from per-day aggregates (a missing day is an unmeasured day, never a fast one). */
export function buildLatencySeries(days: readonly string[], perDay: ReadonlyMap<string, LatencyAggregate>): LatencySeries {
  const series = days.map((day): DayLatency => {
    const a = perDay.get(day)
    return { day, avgMs: a ? averageMs(a) : null, p95Ms: a ? (p95Of(a)?.ms ?? null) : null }
  })
  const all = mergeAggregates(days.map((d) => perDay.get(d)).filter((a): a is LatencyAggregate => !!a))
  return { p95Approximate: true, days: series, avgMs: averageMs(all), p95Ms: p95Of(all)?.ms ?? null }
}
