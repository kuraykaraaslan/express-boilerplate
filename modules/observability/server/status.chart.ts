import type { LatencySeries } from './uptime.latency-buckets'

/**
 * The geometry of the response-time chart (observability phase 15.6), pure: where the polylines of the daily average and the approximate p95 go in a
 * `width` x `height` box. Both the static renderers (snapshot, widget: an inline SVG string) and the React page (inline SVG elements) draw from this,
 * so the two cannot disagree about a day.
 *
 * A day with no latency sample is a GAP (the line breaks), never a zero: an unmeasured day is not a fast one. The scale is 0 to the largest p95 of the
 * window, so the average never touches the roof unless the day was flat.
 *
 * // kui-integration: day-bar chart. The kui track builds a day-bar chart component; when it lands, the plain inline SVG that this feeds is replaced by it
 * // and this function is deleted. Until then it is plain markup on purpose (no new shared component is built here).
 */
export interface ChartGeometry {
  width: number
  height: number
  /** The y-axis maximum in ms (the largest p95 of the window, at least 1). */
  maxMs: number
  /** Polyline point lists (`x,y x,y ...`), one per run of consecutive measured days. */
  avg: string[]
  p95: string[]
}

const PAD = 2

export function chartGeometry(series: LatencySeries, width = 300, height = 48): ChartGeometry {
  const n = series.days.length
  const maxMs = Math.max(1, ...series.days.map((d) => d.p95Ms ?? d.avgMs ?? 0))
  const x = (i: number) => (n <= 1 ? width / 2 : PAD + (i * (width - 2 * PAD)) / (n - 1))
  const y = (ms: number) => height - PAD - (Math.min(ms, maxMs) / maxMs) * (height - 2 * PAD)
  const runs = (pick: (d: LatencySeries['days'][number]) => number | null): string[] => {
    const out: string[] = []
    let cur: string[] = []
    series.days.forEach((d, i) => {
      const v = pick(d)
      if (v === null) { if (cur.length) out.push(cur.join(' ')); cur = []; return }
      cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    })
    if (cur.length) out.push(cur.join(' '))
    return out
  }
  return { width, height, maxMs, avg: runs((d) => d.avgMs), p95: runs((d) => d.p95Ms) }
}
