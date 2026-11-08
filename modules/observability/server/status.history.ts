/**
 * The 90-day bars of a status page (observability phase 15.6), as pure functions over the daily rollup the uptime service already
 * keeps. Nothing here reads a monitor or a database: the caller hands in counts per monitor per day, and gets back one bar per day
 * with a status, a percentage and the ids of the public incidents that started that day.
 *
 * A day with no samples is NO_DATA, never "operational": an unmeasured day is not a good day (the same rule the SLOs follow).
 */

export interface DayCounts { up: number; degraded: number; down: number }

export type DayStatus = 'NO_DATA' | 'OPERATIONAL' | 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE'

export interface DayBar {
  /** UTC calendar day, YYYY-MM-DD. */
  day: string
  status: DayStatus
  /** (up + degraded) / total, two decimals; null when the day has no samples. */
  uptime: number | null
  /** Public incidents that started on this day and touch the component (at most five: the archive has the rest). */
  incidentIds: string[]
}

export const HISTORY_DAYS = 90
const MAX_MARKERS_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000

/** The last `n` UTC days ending at `now`, oldest first. */
export function lastDays(n: number, now: Date): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10))
  return out
}

/**
 * One day's status from its counts. At least half of the samples down is a major outage, any down sample is a partial outage, any
 * degraded sample is degraded, otherwise operational. The thresholds are coarse on purpose: a bar is a glance, the archive is the
 * detail.
 */
export function dayStatus(c: DayCounts): DayStatus {
  const total = c.up + c.degraded + c.down
  if (total === 0) return 'NO_DATA'
  if (c.down > 0 && c.down * 2 >= total) return 'MAJOR_OUTAGE'
  if (c.down > 0) return 'PARTIAL_OUTAGE'
  if (c.degraded > 0) return 'DEGRADED'
  return 'OPERATIONAL'
}

export function dayUptime(c: DayCounts): number | null {
  const total = c.up + c.degraded + c.down
  if (total === 0) return null
  return Math.round(((c.up + c.degraded) / total) * 10000) / 100
}

export interface IncidentMarkerInput {
  incidentId: string
  startedAt: Date
  affectedComponentIds: readonly string[] | null | undefined
}

/**
 * The bars of one component. `countsByMonitorDay` maps monitorId -> day -> counts; the component's monitors are summed per day, so a
 * component with two monitors is as bad as the samples of both say, not as the worse of two percentages.
 */
export function buildDayBars(args: {
  days: readonly string[]
  monitorIds: readonly string[]
  countsByMonitorDay: ReadonlyMap<string, ReadonlyMap<string, DayCounts>>
  componentId: string
  incidents: readonly IncidentMarkerInput[]
}): DayBar[] {
  const markers = new Map<string, string[]>()
  for (const i of args.incidents) {
    const touches = !i.affectedComponentIds || i.affectedComponentIds.length === 0 || i.affectedComponentIds.includes(args.componentId)
    if (!touches) continue
    const day = i.startedAt.toISOString().slice(0, 10)
    const list = markers.get(day) ?? []
    if (list.length < MAX_MARKERS_PER_DAY) list.push(i.incidentId)
    markers.set(day, list)
  }
  return args.days.map((day) => {
    const sum: DayCounts = { up: 0, degraded: 0, down: 0 }
    for (const monitorId of args.monitorIds) {
      const c = args.countsByMonitorDay.get(monitorId)?.get(day)
      if (c) { sum.up += c.up; sum.degraded += c.degraded; sum.down += c.down }
    }
    return { day, status: dayStatus(sum), uptime: dayUptime(sum), incidentIds: markers.get(day) ?? [] }
  })
}
