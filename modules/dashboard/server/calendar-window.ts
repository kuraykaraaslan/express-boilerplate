/**
 * Calendar time windows (20.1b / TW-04): "today", "this week so far", "previous month"... computed in the window's
 * time zone, which is the viewer's browser zone unless the window names one (owner decision D-11, 2026-10-16).
 *
 * The repo has no date library, so zoned wall-clock arithmetic is done here with `Intl` offsets: a period's start is
 * a wall-clock instant in the zone (midnight, the first of the month...) turned into UTC by reading the zone's offset
 * twice, which lands on the right side of a DST change. A midnight that does not exist in the zone (a DST gap at
 * 00:00) resolves to the first instant after the gap.
 *
 * Pure: no database, no request; shared by the window resolver, the URL parser and the tests.
 */

export const CALENDAR_UNITS = ['hour', 'day', 'week', 'isoWeek', 'month', 'quarter', 'halfYear', 'year'] as const
export type CalendarUnit = (typeof CALENDAR_UNITS)[number]

/**
 * `current.<unit>` (the period we are in), `previous.<unit>` (the one before it) and two TB extras. With `soFar`, a
 * current period ends now instead of at its end. 8 + 8 + 2 periods, 26 ranges with the "so far" variants (TB has 24).
 */
export const CALENDAR_PERIODS = [
  ...CALENDAR_UNITS.map((u) => `current.${u}` as const),
  ...CALENDAR_UNITS.map((u) => `previous.${u}` as const),
  'dayBeforeYesterday',
  'thisDayLastWeek',
] as const
export type CalendarPeriod = (typeof CALENDAR_PERIODS)[number]

export const isCalendarPeriod = (v: string): v is CalendarPeriod => (CALENDAR_PERIODS as readonly string[]).includes(v)

/** Is this a period still under way (so "so far" means something, and its data still changes)? */
export const isCurrentPeriod = (p: CalendarPeriod): boolean => p.startsWith('current.')

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
    })
    formatters.set(timeZone, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** A wall-clock reading in a zone. Months are 1-based; `weekday` 0 = Sunday. */
interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number; weekday: number }

function wallAt(t: number, timeZone: string): Wall {
  const p: Record<string, string> = {}
  for (const part of formatter(timeZone).formatToParts(new Date(t))) if (part.type !== 'literal') p[part.type] = part.value
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: WEEKDAYS[p.weekday] ?? 0 }
}

/** The zone's offset from UTC at instant `t`, in ms. */
function offsetAt(t: number, timeZone: string): number {
  const w = wallAt(t, timeZone)
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000
}

/**
 * The UTC instant of a wall-clock time in a zone. Fields may overflow (day 0, month 13): `Date.UTC` normalises them,
 * which is how periods are stepped. Two passes so the offset is the one in force AT that wall time.
 */
function wallToUtc(timeZone: string, y: number, mo: number, d: number, h = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h)
  const first = guess - offsetAt(guess, timeZone)
  const second = guess - offsetAt(first, timeZone)
  // In a DST gap the wall time does not exist: both readings disagree, and the later instant is the first real one.
  return second === first ? second : Math.max(first, second)
}

/** Start of the `unit` holding `t`, `shift` units away (−1 = the previous one), as a UTC instant. */
function unitStart(unit: CalendarUnit, t: number, timeZone: string, shift = 0): number {
  const w = wallAt(t, timeZone)
  switch (unit) {
    case 'hour': return wallToUtc(timeZone, w.y, w.mo, w.d, w.h + shift)
    case 'day': return wallToUtc(timeZone, w.y, w.mo, w.d + shift)
    case 'week': return wallToUtc(timeZone, w.y, w.mo, w.d - w.weekday + 7 * shift)
    case 'isoWeek': return wallToUtc(timeZone, w.y, w.mo, w.d - ((w.weekday + 6) % 7) + 7 * shift)
    case 'month': return wallToUtc(timeZone, w.y, w.mo + shift, 1)
    case 'quarter': return wallToUtc(timeZone, w.y, Math.floor((w.mo - 1) / 3) * 3 + 1 + 3 * shift, 1)
    case 'halfYear': return wallToUtc(timeZone, w.y, (w.mo <= 6 ? 1 : 7) + 6 * shift, 1)
    case 'year': return wallToUtc(timeZone, w.y + shift, 1, 1)
  }
}

/** The bounds of a calendar period at `now` in `timeZone`: `[from, to)`, UTC milliseconds. */
export function calendarBounds(period: CalendarPeriod, now: number, timeZone: string): { from: number; to: number } {
  if (period === 'dayBeforeYesterday') return { from: unitStart('day', now, timeZone, -2), to: unitStart('day', now, timeZone, -1) }
  if (period === 'thisDayLastWeek') return { from: unitStart('day', now, timeZone, -7), to: unitStart('day', now, timeZone, -6) }
  const [which, unit] = period.split('.') as ['current' | 'previous', CalendarUnit]
  const shift = which === 'current' ? 0 : -1
  return { from: unitStart(unit, now, timeZone, shift), to: unitStart(unit, now, timeZone, shift + 1) }
}
