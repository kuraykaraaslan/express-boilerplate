/**
 * Latency baselines (observability phase 09.6, optional and off by default).
 *
 * A fixed `degradedLatencyMs` is the wrong number for a service that is normally 40 ms and now takes 400: that is a tenfold regression
 * far below any sensible fixed ceiling. When `latencyBaselineFactor` is set, a healthy sample slower than `factor ×` the rolling median
 * is DEGRADED. The baseline is the median of recent UP samples from the raw checks (the daily rollup keeps counters only, not
 * latencies), so it needs a minimum sample count before it speaks at all.
 */

export const BASELINE_MIN_SAMPLES = 30
export const BASELINE_WINDOW_SAMPLES = 100

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface BaselineVerdict { degraded: boolean; baselineMs: number | null; ratio: number | null }

export function baselineVerdict(recentUpLatencies: readonly number[], latencyMs: number, factor: number): BaselineVerdict {
  if (!(factor > 1) || recentUpLatencies.length < BASELINE_MIN_SAMPLES) return { degraded: false, baselineMs: null, ratio: null }
  const baselineMs = median(recentUpLatencies)
  if (baselineMs === null || baselineMs <= 0) return { degraded: false, baselineMs, ratio: null }
  const ratio = latencyMs / baselineMs
  return { degraded: ratio > factor, baselineMs, ratio }
}
