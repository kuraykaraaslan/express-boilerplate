/**
 * Incident analytics (observability phase 14): the numbers a team reviews after a month of incidents. Pure over plain rows, so the arithmetic
 * is tested without a database. Times are milliseconds; a metric with nothing to measure is null, never zero (an average of no incidents is
 * not "instant").
 */
export interface IncidentRowForStats {
  incidentId: string
  startedAt: Date | string
  resolvedAt?: Date | string | null
  acknowledgedAt?: Date | string | null
  isAuto: boolean
  severity: string
  affectedComponentIds?: string[] | null
}

const ms = (d: Date | string) => new Date(d).getTime()
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface IncidentAnalytics {
  total: number
  open: number
  resolved: number
  /** Mean and median time from the start to the first acknowledgement, over acknowledged incidents. */
  mtta: { mean: number | null; median: number | null; samples: number }
  /** Mean and median time from the start to resolution, over resolved incidents. */
  mttr: { mean: number | null; median: number | null; samples: number }
  /** Mean gap between the starts of consecutive incidents. Needs two. */
  mtbf: { mean: number | null; median: number | null; samples: number }
  bySeverity: Record<string, number>
  byComponent: Array<{ componentId: string; count: number }>
  perDay: Array<{ day: string; count: number }>
  /** Alerts per incident: how noisy the pipeline is. Null without incidents. */
  alertsPerIncident: number | null
  autoShare: number | null
}

export function computeIncidentAnalytics(rows: readonly IncidentRowForStats[], alertCount: number): IncidentAnalytics {
  const resolved = rows.filter((r) => r.resolvedAt)
  const ttr = resolved.map((r) => ms(r.resolvedAt as Date | string) - ms(r.startedAt)).filter((x) => x >= 0)
  const tta = rows.filter((r) => r.acknowledgedAt).map((r) => ms(r.acknowledgedAt as Date | string) - ms(r.startedAt)).filter((x) => x >= 0)
  const starts = rows.map((r) => ms(r.startedAt)).sort((a, b) => a - b)
  const gaps = starts.slice(1).map((t, i) => t - starts[i])

  const bySeverity: Record<string, number> = {}
  const byComp = new Map<string, number>()
  const byDay = new Map<string, number>()
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1
    for (const c of r.affectedComponentIds ?? []) byComp.set(c, (byComp.get(c) ?? 0) + 1)
    const day = new Date(r.startedAt).toISOString().slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  return {
    total: rows.length, open: rows.length - resolved.length, resolved: resolved.length,
    mtta: { mean: mean(tta), median: median(tta), samples: tta.length },
    mttr: { mean: mean(ttr), median: median(ttr), samples: ttr.length },
    mtbf: { mean: mean(gaps), median: median(gaps), samples: gaps.length },
    bySeverity,
    byComponent: [...byComp.entries()].map(([componentId, count]) => ({ componentId, count })).sort((a, b) => b.count - a.count || a.componentId.localeCompare(b.componentId)),
    perDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
    alertsPerIncident: rows.length ? alertCount / rows.length : null,
    autoShare: rows.length ? rows.filter((r) => r.isAuto).length / rows.length : null,
  }
}
