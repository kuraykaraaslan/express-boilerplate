/**
 * SLA report arithmetic (observability phase 13.5, status-page uptime report). PURE: no I/O, no clock; every rule here is a unit test against a
 * hand-computed fixture.
 *
 * WHAT THE NUMBERS ARE, and why this can never disagree with the status page or an SLO:
 *
 *  - The published figure, `uptimePercent`, is the SAMPLE ratio `(up + degraded) / (up + degraded + down)` over the daily rollup, with the same
 *    rounding as `uptimePercent()` of `status.uptime.service.ts`. The rollup already left out every sample taken during planned maintenance
 *    when the tenant keeps maintenance out of uptime (`observabilityExcludeMaintenanceFromUptime`, applied at write time: the probe sets
 *    `duringMaintenance` and skips the rollup bump). The report reads that rollup, so it inherits the rule instead of re-deriving it.
 *    One deliberate difference: with NO samples the status page shows 100 (an unmeasured window shows no false outage); the report shows
 *    `null`, because an SLA document must never present "we did not look" as "up".
 *  - The minute figures (`excludedMaintenanceMinutes`, `downtimeMinutes`, `unknownMinutes`, the longest outage) come from the RAW checks, which
 *    carry the `duringMaintenance` evidence the exclusion used. Each sample covers the time up to the next sample, at most twice the monitor's
 *    probe interval; time no sample covers, and time covered only by an inconclusive (UNKNOWN) sample, is UNKNOWN: reported on its own, in
 *    neither the downtime nor the uptime. Raw checks age out, so a period older than the retention window has no minute figures (they are `null`
 *    and `timeline` says why) while the published figure still exists.
 *  - Maintenance minutes are the UNION of the maintenance coverage (two overlapping windows are not subtracted twice), and an outage inside
 *    maintenance is not downtime: a sample flagged `duringMaintenance` is maintenance, whatever its status. When the tenant does NOT keep
 *    maintenance out of uptime, the flag is ignored here too, exactly as the rollup ignored it.
 *  - Several voters (a component with several monitors, a monitor probed from several locations) are combined per instant: the component is
 *    DOWN when any voter is down, in MAINTENANCE only when every voter that has data is in maintenance, UNKNOWN when none has data, else UP.
 *    The published sample ratio pools the samples of all voters, so a partial outage dilutes there and counts fully in the minutes: both are
 *    stated in the report notes.
 *  - The period is whole UTC days (the rollup's bucket); the end is clipped to "now", so a report that includes today is not padded with
 *    future minutes. Minutes are measured in epoch milliseconds, so a daylight-saving change in anybody's local zone cannot add or remove any.
 */

export const MINUTE_MS = 60_000
export const DAY_MS = 86_400_000

export interface Interval { start: number; end: number }

// ---- interval algebra (half-open [start, end)) --------------------------------------------------------------------------------------

/** Sorted, non-empty, non-overlapping, touching intervals merged. */
export function normalize(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).map((i) => ({ ...i })).sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end)
    else out.push(i)
  }
  return out
}

export function union(...lists: Array<readonly Interval[]>): Interval[] { return normalize(lists.flat()) }

/** `a` and `b` must be normalised. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  let i = 0; let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start); const end = Math.min(a[i].end, b[j].end)
    if (end > start) out.push({ start, end })
    if (a[i].end < b[j].end) i++; else j++
  }
  return out
}

/** `a` minus `b`; both must be normalised. */
export function subtract(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  let j = 0
  for (const x of a) {
    let cursor = x.start
    while (j < b.length && b[j].end <= cursor) j++
    let k = j
    while (k < b.length && b[k].start < x.end) {
      if (b[k].start > cursor) out.push({ start: cursor, end: b[k].start })
      cursor = Math.max(cursor, b[k].end)
      k++
    }
    if (cursor < x.end) out.push({ start: cursor, end: x.end })
  }
  return out
}

export function clip(list: readonly Interval[], period: Interval): Interval[] { return intersect(normalize(list), [period]) }
export function measure(list: readonly Interval[]): number { return list.reduce((n, i) => n + (i.end - i.start), 0) }

// ---- one voter: a series of samples -> up / down / maintenance coverage ----------------------------------------------------------------

export interface SlaSample {
  /** Epoch ms. */
  t: number
  /** UP, DEGRADED, DOWN or UNKNOWN (an inconclusive sample). Anything else is treated as UNKNOWN. */
  status: string
  /** The sample was taken while a maintenance window was open (recorded at write time). */
  maintenance: boolean
}

export interface VoterSets { up: Interval[]; down: Interval[]; maintenance: Interval[] }

/** How long a sample speaks for at most: twice the probe interval (a probe a little late is still the same state; a long silence is unknown). */
export function sampleCoverMs(intervalSeconds: number): number {
  return Math.max(2 * Math.max(1, intervalSeconds) * 1000, 2 * MINUTE_MS)
}

/**
 * Coverage of one sample stream inside `period`. Each sample speaks from its own time to the next sample, at most `coverMs`. A sample flagged as
 * taken during maintenance is MAINTENANCE (when maintenance is excluded) whatever its status; UP and DEGRADED are up; DOWN is down; UNKNOWN speaks
 * for nothing (its time stays unknown). Samples may start before the period (they are clipped) and must be given in any order.
 */
export function voterSets(samples: readonly SlaSample[], period: Interval, coverMs: number, excludeMaintenance: boolean): VoterSets {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const up: Interval[] = []; const down: Interval[] = []; const maintenance: Interval[] = []
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i]
    const next = sorted[i + 1]
    const end = Math.min(next ? next.t : Infinity, s.t + coverMs)
    const span: Interval = { start: Math.max(s.t, period.start), end: Math.min(end, period.end) }
    if (span.end <= span.start) continue
    if (excludeMaintenance && s.maintenance) maintenance.push(span)
    else if (s.status === 'UP' || s.status === 'DEGRADED') up.push(span)
    else if (s.status === 'DOWN') down.push(span)
  }
  return { up: normalize(up), down: normalize(down), maintenance: normalize(maintenance) }
}

export interface TimelineSets { up: Interval[]; down: Interval[]; maintenance: Interval[]; unknown: Interval[] }

/** Several voters at one instant: DOWN if any is down; MAINTENANCE only when every voter that has data is in maintenance; UNKNOWN when none has data. */
export function combineVoters(voters: readonly VoterSets[], period: Interval): TimelineSets {
  const anyUp = union(...voters.map((v) => v.up))
  const anyDown = union(...voters.map((v) => v.down))
  const anyMaintenance = union(...voters.map((v) => v.maintenance))
  const down = anyDown
  const up = subtract(anyUp, anyDown)
  // Maintenance counts only where no voter is doing real work (up or down): a voter in maintenance must not hide another voter's outage.
  const maintenance = subtract(anyMaintenance, union(anyUp, anyDown))
  const unknown = subtract([period], union(up, down, maintenance))
  return { up, down, maintenance, unknown }
}

// ---- one row -----------------------------------------------------------------------------------------------------------------------

export interface RollupCounts { good: number; bad: number }

export interface SlaRowInput {
  /** Stable id of the row (component id or SLO id). */
  key: string
  name: string
  monitorCount: number
  period: Interval
  /** The rollup counts over the period's UTC days, or null when the rollup has nothing to read. */
  samples: RollupCounts | null
  /** The raw-check timeline, or null when raw checks do not reach back to the start of the period. */
  timeline: TimelineSets | null
  /** Why there is no timeline, for the report. */
  timelineReason?: string
  incidents: number | null
  objectivePercent: number | null
}

export interface SlaRow {
  key: string
  name: string
  monitorCount: number
  /** Exact length of the period in minutes (epoch arithmetic). */
  totalMinutes: number
  /** Maintenance that was left out of the denominator and of the downtime. Null without a timeline. */
  excludedMaintenanceMinutes: number | null
  /** Time nobody measured (no probe, or only inconclusive ones). Never counted as up. Null without a timeline. */
  unknownMinutes: number | null
  downtimeMinutes: number | null
  upMinutes: number | null
  /** The published figure: sample ratio over the rollup, equal to the status page's. Null when there are no samples. */
  uptimePercent: number | null
  /** up / (up + down) in minutes. Null without a timeline or without measured time. */
  minutesUptimePercent: number | null
  /** Share of the non-maintenance time that was measured. */
  coveragePercent: number | null
  samplesGood: number | null
  samplesTotal: number | null
  incidents: number | null
  /** Separate outages in the timeline (contiguous downtime). */
  outages: number | null
  longestOutageMinutes: number | null
  objectivePercent: number | null
  /** The published figure against the objective; null when there is no objective or no figure. */
  objectiveMet: boolean | null
  timeline: 'available' | 'unavailable'
  timelineReason: string | null
}

export const roundMinutes = (ms: number): number => Math.round(ms / MINUTE_MS * 100) / 100
const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 10000) / 100 : null)

/** The same arithmetic and rounding as `uptimePercent()` of the status page, except that no samples is null, not 100. */
export function samplePercent(c: RollupCounts | null): number | null {
  return c && c.good + c.bad > 0 ? pct(c.good, c.good + c.bad) : null
}

export function computeSlaRow(input: SlaRowInput): SlaRow {
  const { period, timeline, samples } = input
  const total = period.end - period.start
  const published = samplePercent(samples)
  const base = {
    key: input.key, name: input.name, monitorCount: input.monitorCount, totalMinutes: roundMinutes(total),
    uptimePercent: published,
    samplesGood: samples ? samples.good : null,
    samplesTotal: samples ? samples.good + samples.bad : null,
    incidents: input.incidents, objectivePercent: input.objectivePercent,
    objectiveMet: input.objectivePercent !== null && published !== null ? published >= input.objectivePercent : null,
  }
  if (!timeline) {
    return {
      ...base, excludedMaintenanceMinutes: null, unknownMinutes: null, downtimeMinutes: null, upMinutes: null, minutesUptimePercent: null, coveragePercent: null,
      outages: null, longestOutageMinutes: null, timeline: 'unavailable', timelineReason: input.timelineReason ?? 'no raw checks for this period',
    }
  }
  const up = measure(timeline.up); const down = measure(timeline.down); const excluded = measure(timeline.maintenance); const unknown = measure(timeline.unknown)
  const outages = timeline.down.length
  const longest = timeline.down.reduce((m, i) => Math.max(m, i.end - i.start), 0)
  return {
    ...base,
    excludedMaintenanceMinutes: roundMinutes(excluded), unknownMinutes: roundMinutes(unknown), downtimeMinutes: roundMinutes(down), upMinutes: roundMinutes(up),
    minutesUptimePercent: pct(up, up + down), coveragePercent: pct(up + down, total - excluded),
    outages, longestOutageMinutes: roundMinutes(longest), timeline: 'available', timelineReason: null,
  }
}

// ---- period ------------------------------------------------------------------------------------------------------------------------

export const MAX_PERIOD_DAYS = 92
/** How far back a report may start. The rollup is kept for ever, but a report is for a billing or review period, not an archive dump. */
export const MAX_LOOKBACK_DAYS = 366

export interface ReportPeriod {
  fromDay: string
  toDay: string
  /** [start of fromDay, end of toDay) clipped to now. */
  interval: Interval
  days: number
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const dayStart = (d: string): number => Date.parse(`${d}T00:00:00.000Z`)
const isRealDay = (d: string): boolean => DAY_RE.test(d) && new Date(dayStart(d)).toISOString().slice(0, 10) === d

/** Validate and normalise `from` / `to` (UTC dates, both inclusive). Returns the reason as an error string, so callers decide the status code. */
export function resolvePeriod(from: string, to: string, now: Date): { ok: true; period: ReportPeriod } | { ok: false; error: string } {
  if (!isRealDay(from) || !isRealDay(to)) return { ok: false, error: 'from and to must be real UTC dates written YYYY-MM-DD' }
  const start = dayStart(from)
  const end = dayStart(to) + DAY_MS
  if (end <= start) return { ok: false, error: 'to must not be before from' }
  const days = Math.round((end - start) / DAY_MS)
  if (days > MAX_PERIOD_DAYS) return { ok: false, error: `a report covers at most ${MAX_PERIOD_DAYS} days` }
  if (start > now.getTime()) return { ok: false, error: 'the period starts in the future' }
  if (start < now.getTime() - MAX_LOOKBACK_DAYS * DAY_MS) return { ok: false, error: `a report starts at most ${MAX_LOOKBACK_DAYS} days back` }
  return { ok: true, period: { fromDay: from, toDay: to, interval: { start, end: Math.min(end, now.getTime()) }, days } }
}

// ---- the report --------------------------------------------------------------------------------------------------------------------

export interface SlaReport {
  scope: { kind: 'status_page' | 'slo'; id: string; name: string }
  period: { from: string; to: string; start: string; end: string; days: number }
  generatedAt: string
  maintenanceExcluded: boolean
  rawRetentionDays: number
  rows: SlaRow[]
  notes: string[]
}

export const REPORT_NOTES: readonly string[] = [
  'Period: whole UTC days, both ends inclusive; the end is clipped to the time of the report.',
  'Uptime % is the sample ratio (up + degraded) / (up + degraded + down) over the daily rollup: the figure the status page and the SLOs use. No samples is shown empty, never as 100.',
  'Maintenance: samples taken during planned maintenance are left out of the denominator and of the downtime when the workspace keeps maintenance out of uptime; the minutes are the union of that coverage.',
  'Unknown minutes (no probe, or only inconclusive probes) are reported separately and are never counted as up.',
  'Downtime counts a component as down while any of its monitors, or any location of a monitor, is down; the published ratio pools the samples, so a partial outage weighs less there.',
  'Minute figures come from raw checks and are empty for a period older than the raw retention window.',
]

// ---- CSV ---------------------------------------------------------------------------------------------------------------------------

/** Control characters that have no place in a cell (a newline inside a name would break a row in a naive reader). */
const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/g

/** Text for a cell or a PDF line: control characters become spaces, nothing else is changed. */
export function cleanText(v: string): string { return v.replace(CONTROL, ' ').trim() }

/**
 * RFC 4180 quoting plus spreadsheet formula neutralisation (the same rule as the on-call reports): a cell that starts with = + - @ tab or CR gets a
 * leading apostrophe, so a component named `=HYPERLINK(...)` is text in Excel and Sheets. Numbers are written as numbers, never neutralised (a
 * negative number cannot occur in this report; the check is on text only).
 */
export function csvCell(v: string | number | boolean | null): string {
  if (v === null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  const text = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export const CSV_COLUMNS = [
  'component', 'monitors', 'period_from', 'period_to', 'total_minutes', 'excluded_maintenance_minutes', 'unknown_minutes', 'downtime_minutes',
  'uptime_percent', 'minutes_uptime_percent', 'coverage_percent', 'samples_good', 'samples_total', 'incidents', 'outages', 'longest_outage_minutes',
  'objective_percent', 'objective_met', 'minute_figures',
] as const

export function reportToCsv(report: SlaReport): string {
  const rows = report.rows.map((r) => [
    cleanText(r.name), r.monitorCount, report.period.from, report.period.to, r.totalMinutes, r.excludedMaintenanceMinutes, r.unknownMinutes, r.downtimeMinutes,
    r.uptimePercent, r.minutesUptimePercent, r.coveragePercent, r.samplesGood, r.samplesTotal, r.incidents, r.outages, r.longestOutageMinutes,
    r.objectivePercent, r.objectiveMet, r.timeline === 'available' ? 'available' : `unavailable: ${r.timelineReason ?? ''}`,
  ])
  return `${[CSV_COLUMNS as readonly string[], ...rows].map((r) => r.map((c) => csvCell(c as string | number | boolean | null)).join(',')).join('\r\n')}\r\n`
}

/** An ASCII file name that cannot carry a path, a header break or a quote: `sla-report-<slug>-<from>_<to>.<ext>`. */
export function reportFilename(name: string, from: string, to: string, ext: 'csv' | 'pdf' | 'json'): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report'
  return `sla-report-${slug}-${from}_${to}.${ext}`
}
