import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { zodFromSchema } from '@kuraykaraaslan-labs/common/server/schema-form.zod'
import type { FieldSchema } from '@kuraykaraaslan-labs/common/server/schema-form.types'
import MSG from './dashboard.messages'
import { isInternalPath } from './internal-path'
import { CALENDAR_PERIODS, calendarBounds, isCurrentPeriod } from './calendar-window'

/**
 * Board-wide time window and typed viewer parameters
 * (`docs/phases/07-dashboard/10-board-time-window-and-viewer-params.md`).
 *
 * Everything here is pure — no database, no request — so the executor route, the
 * board DTOs and the tests share one definition of "what window is this", and
 * the cache key of a bound query is a function of it.
 */

/** The relative windows offered as presets. Any other `last N minutes / hours / days` is accepted too (20.1c, TW-02). */
export const RELATIVE_WINDOWS = ['5m', '15m', '30m', '1h', '6h', '12h', '24h', '3d', '7d', '14d', '30d', '90d', '365d'] as const
/** `<n>m`, `<n>h` or `<n>d`, from one minute to the maximum span (`relativeMs` checks the bound). */
export type RelativeWindow = string
const RELATIVE_PATTERN = /^([1-9]\d{0,5})([mhd])$/
export const WINDOW_INTERVALS = ['auto', '1m', '5m', '10m', '15m', '30m', '1h', '2h', '6h', '12h', '1d', '7d'] as const
export type WindowInterval = (typeof WINDOW_INTERVALS)[number]
export const WINDOW_AGGREGATIONS = ['avg', 'min', 'max', 'sum', 'count', 'none'] as const
export type WindowAggregation = (typeof WINDOW_AGGREGATIONS)[number]

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A relative window's span in ms, or null for anything that is not `<n>m|h|d` between one minute and the maximum span. */
export function relativeMs(last: string): number | null {
  const m = RELATIVE_PATTERN.exec(last)
  if (!m) return null
  const ms = Number(m[1]) * (m[2] === 'm' ? MINUTE : m[2] === 'h' ? HOUR : DAY)
  return ms >= MINUTE && ms <= MAX_WINDOW_MS ? ms : null
}
const INTERVAL_MS: Record<Exclude<WindowInterval, 'auto'>, number> = {
  '1m': MINUTE, '5m': 5 * MINUTE, '10m': 10 * MINUTE, '15m': 15 * MINUTE, '30m': 30 * MINUTE,
  '1h': HOUR, '2h': 2 * HOUR, '6h': 6 * HOUR, '12h': 12 * HOUR, '1d': DAY, '7d': 7 * DAY,
}
/** Steps in ascending order, for snapping a chosen interval into the allowed range. */
const STEPS = Object.values(INTERVAL_MS).sort((a, b) => a - b)
/** No window is cut into more buckets than this (TW-05, the TB rule): a year at one minute would be 525,600. */
export const MAX_BUCKETS = 500

/** The longest range a board window may span; a probe for "everything" is refused, not truncated. */
export const MAX_WINDOW_MS = 366 * DAY
/** At most this many typed parameters per board (no alias / filter language). Raised from 8 for entity-style drill-downs (17.3a, D-4). */
export const MAX_BOARD_PARAMS = 16
/**
 * Phase 41 (D41-8): a board's parameters, values and entities together, at most the limits of the two lists they replace (16
 * parameters, 32 entity aliases). The value parameters keep their own 16, and the filter bar still shows at most 16.
 */
export const MAX_BOARD_PARAMS_TOTAL = 48

/**
 * An IANA zone name. Validated by `Intl`, never trusted as a string, and stored in `Intl`'s own spelling
 * (`europe/istanbul` becomes `Europe/Istanbul`), so case variants of one zone are one cache token, not many.
 */
export const TimeZoneSchema = z
  .string()
  .max(64)
  .refine((tz) => {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
  }, 'Invalid timezone')
  .transform((tz) => new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone)

const commonFields = {
  interval: z.enum(WINDOW_INTERVALS).optional(),
  aggregation: z.enum(WINDOW_AGGREGATIONS).optional(),
  timezone: TimeZoneSchema.optional(),
}

export const TimeWindowSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('relative'), last: z.string().max(8).refine((v) => relativeMs(v) !== null, 'Invalid relative window'), ...commonFields }).strict(),
  // 20.1b / TW-04: a calendar period in the window's zone ("today", "previous month"); `soFar` ends a current period now.
  z.object({ mode: z.literal('calendar'), period: z.enum(CALENDAR_PERIODS), soFar: z.boolean().optional(), ...commonFields }).strict(),
  z
    .object({ mode: z.literal('absolute'), from: z.string().datetime(), to: z.string().datetime(), ...commonFields })
    .strict()
    .refine((v) => Date.parse(v.to) > Date.parse(v.from), { message: '`to` must be after `from`', path: ['to'] })
    .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= MAX_WINDOW_MS, { message: 'Window too large', path: ['to'] }),
])
export type TimeWindow = z.infer<typeof TimeWindowSchema>

/**
 * A bound query may read the window just before the one it follows (24.2b): the same length, ending where the
 * window starts, for "this week against last week" without a second window setting.
 */
export const WINDOW_OFFSETS = ['previous'] as const
export const WindowOffsetSchema = z.enum(WINDOW_OFFSETS)
export type WindowOffset = z.infer<typeof WindowOffsetSchema>

/** What an executor hands a source: concrete instants, never the user's shorthand. */
export interface ResolvedWindow {
  from: string
  to: string
  interval: string
  aggregation: string
  timezone: string
  /**
   * A calendar period still under way: where it ends. `to` is what the query reads up to (now, rounded down); the
   * period end is how far a live append may run and, unless the window says "so far", where a chart's axis ends.
   */
  periodEnd?: string
}

/**
 * The field types a board parameter may use — the ones whose value the query's
 * own param schema can still re-validate server-side. `remote-select` only
 * OFFERS options; the chosen value is never trusted because of it.
 */
export const BOARD_PARAM_TYPES = ['text', 'number', 'select', 'multi-select', 'remote-select', 'boolean', 'date'] as const

const ParamFieldSchema = z
  .object({
    label: z.string().min(1).max(80),
    type: z.enum(BOARD_PARAM_TYPES),
    options: z.array(z.union([z.string().max(120), z.object({ label: z.string().max(120), value: z.string().max(120) }).strict()])).max(100).optional(),
    placeholder: z.string().max(120).optional(),
    description: z.string().max(240).optional(),
    required: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    // `isInternalPath`, not a bare `^/(?!/)`: `/\host` and `/<TAB>/host` are protocol-relative to a browser (dashboard.11).
    endpoint: z.string().max(300).refine(isInternalPath, 'endpoint must be an internal path').optional(),
    dataKey: z.string().max(60).optional(),
    labelKey: z.string().max(60).optional(),
    valueKey: z.string().max(60).optional(),
    emptyLabel: z.string().max(80).optional(),
    // Searchable entity picker (17.1): query parameter names, never URL parts.
    searchKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/, 'Invalid search key').optional(),
    lookupKey: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/, 'Invalid lookup key').optional(),
  })
  .strict()

/** Names an `Object.prototype` member already answers on a plain object: never a parameter key (a lookup must not hit the prototype). */
const RESERVED_PARAM_KEYS = new Set(['constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toString', 'toLocaleString', 'valueOf'])
export const isReservedParamKey = (k: string): boolean => k === '__proto__' || RESERVED_PARAM_KEYS.has(k)

export const BoardParamKeySchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'Invalid parameter key')
  .refine((k) => !isReservedParamKey(k), 'Reserved parameter key')

/**
 * The viewer's parameter overrides on a board context (query, live ticket, command, query batch, stored placement query):
 * at most `MAX_BOARD_PARAMS_TOTAL` entries (an entity parameter's pick travels here too since phase 41), each keyed like a board parameter. The raw object is checked BEFORE the record
 * parse, because a JSON `"__proto__"` key is an own property of the parsed body that the record parse drops silently
 * (it never reaches the output, and the output keeps the normal prototype): without this check it was accepted as a 2xx
 * instead of being the 400 every other bad key is (security case 2026-10-18, `dashboard.command-query.security.test.ts`).
 */
export const BoardContextParamsSchema = z
  .custom<Record<string, unknown>>(
    (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.prototype.hasOwnProperty.call(v, '__proto__'),
    'Invalid parameters',
  )
  .pipe(z.record(BoardParamKeySchema, z.unknown()))
  .refine((r) => Object.keys(r).length <= MAX_BOARD_PARAMS_TOTAL, `At most ${MAX_BOARD_PARAMS_TOTAL} parameters`)

export const BoardParamDefSchema = z
  .object({
    key: BoardParamKeySchema,
    label: z.string().min(1).max(80),
    field: ParamFieldSchema,
    default: z.unknown().optional(),
    /**
     * What the value identifies (17.3a): a free slug the owning module defines (`device`, `site`).
     * Informational today: it lets a param bar, a trail label or an importer know the value is an
     * entity id; the value is still validated by the field and by each query's own schema.
     */
    entityType: z.string().regex(/^[a-z][a-z0-9_.-]{0,59}$/, 'Invalid entity type').optional(),
    /**
     * Phase 29: the list of a `remote-select` depends on another param (the variables of the device picked): the picker
     * sends that param's value as `dependsOnQuery` (default: its key) and waits until it has one, and a value is cleared
     * when the param it depends on changes.
     */
    dependsOn: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, 'Invalid parameter key').optional(),
    dependsOnQuery: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/, 'Invalid query name').optional(),
    /**
     * Phase 35: where an unset parameter with no default takes its value from. `firstOption` (a `select` or a
     * `remote-select` only): the filter bar writes the first option its list has, through the same sanitising as a
     * viewer's pick, replacing the history entry; an empty list leaves it unset (a page's "pick one" stays the fallback).
     * An authored default wins: it is meant for any viewer.
     */
    defaultFrom: z.literal('firstOption').optional(),
    /**
     * Phase 35: how the filter bar shows the parameter: `edit` (the default) a picker, `readOnly` the value in a disabled
     * picker, `hidden` nothing. Presentation only: a link (`p.<key>`), a host and an action's `setParams` still set it,
     * and every value is still validated by the field and by each query's own schema.
     */
    viewer: z.enum(['edit', 'readOnly', 'hidden']).optional(),
  })
  .strict()

/** How the filter bar shows a parameter (`BoardParamDef.viewer`, phase 35); absent = `edit`. */
export const PARAM_VIEWER_MODES = ['edit', 'readOnly', 'hidden'] as const

/** The field types whose list has a first option (`defaultFrom: 'firstOption'`, phase 35). */
export const FIRST_OPTION_TYPES: ReadonlySet<string> = new Set(['select', 'remote-select'])

export const BoardParamsSchema = z
  .array(BoardParamDefSchema)
  .max(MAX_BOARD_PARAMS)
  .superRefine((defs, ctx) => {
    const seen = new Set<string>()
    defs.forEach((d, i) => {
      if (seen.has(d.key)) ctx.addIssue({ code: 'custom', message: 'Duplicate parameter key', path: [i, 'key'] })
      seen.add(d.key)
      for (const issue of valueParamIssues(d)) ctx.addIssue({ code: 'custom', message: issue.message, path: [i, issue.field] })
    })
    for (const issue of dependsOnIssues(defs)) ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.index, 'dependsOn'] })
  })
export type BoardParamDef = z.infer<typeof BoardParamDefSchema>

/** What is wrong with one value parameter on its own: a default its field refuses, a first option its field has none of. */
export function valueParamIssues(d: BoardParamDef): Array<{ field: 'default' | 'defaultFrom'; message: string }> {
  const out: Array<{ field: 'default' | 'defaultFrom'; message: string }> = []
  if (d.default !== undefined && !validateParamValue(d, d.default).ok) out.push({ field: 'default', message: 'Default does not match the field' })
  if (d.defaultFrom === 'firstOption' && !FIRST_OPTION_TYPES.has(d.field.type)) {
    out.push({ field: 'defaultFrom', message: 'Only a select or a remote-select has a first option' })
  }
  return out
}

/**
 * `dependsOn` names another param of the board (any kind, phase 41), and following it never comes back (no cycle). By index into
 * `defs`; a param without `dependsOn` (an entity parameter has none) only ends a chain.
 */
export function dependsOnIssues(defs: ReadonlyArray<{ key: string; dependsOn?: string }>): Array<{ index: number; message: string }> {
  const out: Array<{ index: number; message: string }> = []
  const byKey = new Map(defs.map((d) => [d.key, d]))
  defs.forEach((d, i) => {
    if (d.dependsOn === undefined) return
    if (d.dependsOn === d.key || !byKey.has(d.dependsOn)) {
      out.push({ index: i, message: 'dependsOn must name another parameter of this board' })
      return
    }
    const seenChain = new Set([d.key])
    for (let at = byKey.get(d.dependsOn); at; at = at.dependsOn ? byKey.get(at.dependsOn) : undefined) {
      if (seenChain.has(at.key)) { out.push({ index: i, message: 'dependsOn makes a cycle' }); return }
      seenChain.add(at.key)
    }
  })
  return out
}

/** `YYYY-MM-DD` naming a real day. */
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** A value a board parameter can carry into `ctx.vars`: scalars only, so a source never receives a structure. */
export type ParamValue = string | number | boolean | string[]

/**
 * Validate one value against one parameter's field, with the same zod the query params use, plus what the field
 * declares and the shared validator does not check (phase 35, B3): a number's `step`, a multi-select's options
 * (every item) and `required`. An explicitly EMPTY value (`''`, an empty list) for a required parameter is refused;
 * an absent one is not this function's to judge (the caller lets the default apply, or the page asks for it).
 */
export function validateParamValue(def: BoardParamDef, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const field = def.field
  if (field.required && (value === '' || (Array.isArray(value) && value.length === 0))) return { ok: false }
  // A date parameter is a calendar day, `YYYY-MM-DD`, and nothing else. The shared field validator lets a
  // `date` field through as unknown (its renderer owns the format), which is not enough for a value that
  // reaches a query: check the shape AND that the day exists (2026-02-30 is refused).
  if (field.type === 'date') return isCalendarDay(value) ? { ok: true, value } : { ok: false }
  const schema: Record<string, FieldSchema> = { v: field as unknown as FieldSchema }
  const parsed = zodFromSchema(schema).safeParse({ v: value })
  if (!parsed.success || parsed.data.v === undefined) return { ok: false }
  const out = parsed.data.v
  // The step is the number's grid, anchored at `min` (0 without one), the way the controls snap a slider.
  if (field.type === 'number' && typeof out === 'number' && typeof field.step === 'number' && field.step > 0 && !onStep(out, field.step, field.min ?? 0)) {
    return { ok: false }
  }
  // A multi-select with declared options takes those values only; the shared validator checks the shape alone.
  if (field.type === 'multi-select' && Array.isArray(out) && field.options?.length) {
    const allowed = new Set(field.options.map((o) => (typeof o === 'string' ? o : o.value)))
    if (!out.every((item) => allowed.has(String(item)))) return { ok: false }
  }
  return { ok: true, value: out }
}

/** Is `n` on the grid of `step` from `anchor`? A float residue (0.1 + 0.2) is forgiven. */
function onStep(n: number, step: number, anchor: number): boolean {
  const k = (n - anchor) / step
  return Math.abs(k - Math.round(k)) < 1e-9
}

/**
 * The effective parameter values: board defaults, then viewer overrides on top.
 *
 * An override naming a key the board does not define is refused (a typo or a
 * probe); one that fails its field is a 422, the same status a `$param`
 * reference that resolves to a bad value gets.
 */
export function resolveParamValues(
  defs: BoardParamDef[] | null | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const list = defs ?? []
  const byKey = new Map(list.map((d) => [d.key, d]))
  for (const key of Object.keys(overrides ?? {})) {
    if (!byKey.has(key)) throw new AppError(`${MSG.BOARD_PARAM_UNKNOWN}: '${key}'`, 400, ErrorCode.VALIDATION_ERROR)
  }
  const out: Record<string, unknown> = {}
  for (const def of list) {
    const raw = overrides && Object.prototype.hasOwnProperty.call(overrides, def.key) ? overrides[def.key] : def.default
    if (raw === undefined || raw === null || raw === '') continue
    const checked = validateParamValue(def, raw)
    if (!checked.ok) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${def.key}'`, 422, ErrorCode.VALIDATION_ERROR)
    out[def.key] = checked.value
  }
  return out
}

/**
 * `ctx.vars` narrowed to what a query declares it reads (`readsVars`, phase 35.2); every var without a declaration. Own keys
 * only, so a declared name never reads a prototype member.
 */
export function varsFor(vars: Record<string, string | number | boolean>, readsVars: readonly string[] | undefined): Record<string, string | number | boolean> {
  if (!Array.isArray(readsVars)) return vars
  const out: Record<string, string | number | boolean> = {}
  for (const key of readsVars) if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(vars, key)) out[key] = vars[key]
  return out
}

/** The scalar subset of resolved params that `ctx.vars` exposes. */
export function toVars(values: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.join(',')
  }
  return out
}

/**
 * A `{ "$param": "<key>" }` slot value, instead of a literal. Since phase 41 an entity parameter is named the same way and may
 * add a board filter (`"filter": "<key>"`, what `{ $alias, filter }` carried in 36.7); a value parameter refuses the filter where
 * it is substituted.
 */
export function isParamRef(value: unknown): value is { $param: string; filter?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as { $param?: unknown; filter?: unknown }
  return typeof v.$param === 'string' && Object.keys(value).every((k) => k === '$param' || k === 'filter')
    && (v.filter === undefined || typeof v.filter === 'string')
}

/**
 * Every board parameter key a placement's data binding still references with
 * `{ "$param": key }` (15.5a). Pure: the caller hands over the stored bindings.
 */
export function referencedParamKeys(bindings: Array<Record<string, { params?: Record<string, unknown> } | null | undefined> | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const binding of bindings) {
    for (const slot of Object.values(binding ?? {})) {
      for (const value of Object.values(slot?.params ?? {})) if (isParamRef(value)) out.add(value.$param)
    }
  }
  return out
}

// The command-only collector that used to sit here (`referencedActionParamKeys`) is replaced by
// `placement-references.ts` (phase 35, E9), which reads every reference a placement makes.

/** The parameters present in `before` and gone from `after`, by key. */
export function removedParamKeys(before: Array<{ key: string }> | null | undefined, after: Array<{ key: string }> | null | undefined): string[] {
  const kept = new Set((after ?? []).map((p) => p.key))
  return (before ?? []).map((p) => p.key).filter((k) => !kept.has(k))
}

/**
 * Replace `$param` references with the board's current values BEFORE the query's
 * own `validateParams` runs, so a source only ever sees a validated literal and
 * the "no URL field" guarantee is unchanged. A reference to a parameter the board
 * does not define, or one with no value, is a 422 — never a partial query.
 *
 * One exception (D442): when `mayLeaveOut(slotKey, paramKey)` says so for a parameter with no value, the slot is
 * left out and the query's own default applies. `prepareParams` allows it only for a hidden parameter (no control
 * of the viewer's sets it, only the board's own clicks do) bound to an input the query does not require: the
 * equipment panel's `equipmentKeys`, which a click on an item of the element convention leaves empty.
 */
export function substituteParamRefs(
  params: Record<string, unknown>,
  values: Record<string, unknown>,
  hasBoardContext: boolean,
  mayLeaveOut: (slotKey: string, paramKey: string) => boolean = () => false,
): { params: Record<string, unknown>; referenced: boolean } {
  let referenced = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (!isParamRef(value)) { out[key] = value; continue }
    referenced = true
    // A filter narrows an entity parameter's set; a value has no set to narrow.
    if (value.filter !== undefined) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${value.$param}'`, 422, ErrorCode.VALIDATION_ERROR)
    if (!hasBoardContext || !Object.prototype.hasOwnProperty.call(values, value.$param)) {
      if (hasBoardContext && mayLeaveOut(key, value.$param)) continue
      throw new AppError(`${MSG.BOARD_PARAM_UNRESOLVED}: '${value.$param}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
    out[key] = values[value.$param]
  }
  return { params: out, referenced }
}

/**
 * The bucket size for a span. A chosen interval is kept when it cuts the span into at most `MAX_BUCKETS` buckets and is
 * not longer than the span itself; otherwise it snaps to the nearest allowed step inside that range (TW-05), so no
 * window asks a source for half a million points and no window is one bucket wider than itself.
 */
function intervalFor(interval: WindowInterval | undefined, spanMs: number): number {
  if (interval && interval !== 'auto') {
    const chosen = INTERVAL_MS[interval]
    const finest = STEPS.find((s) => spanMs / s <= MAX_BUCKETS) ?? STEPS[STEPS.length - 1]
    const coarsest = [...STEPS].reverse().find((s) => s <= spanMs) ?? STEPS[0]
    return Math.min(Math.max(chosen, finest), Math.max(coarsest, finest))
  }
  if (spanMs <= HOUR) return INTERVAL_MS['1m']
  if (spanMs <= DAY) return INTERVAL_MS['5m']
  if (spanMs <= 7 * DAY) return INTERVAL_MS['1h']
  return INTERVAL_MS['1d']
}

/** How stale a relative or current window's end may be: its interval, but never more than five minutes (TW-01). */
export const FRESH_END_MS = 5 * MINUTE
const freshEnd = (now: number, step: number): number => {
  const unit = Math.min(step, FRESH_END_MS)
  return Math.floor(now / unit) * unit
}

const intervalName = (ms: number): string =>
  (Object.entries(INTERVAL_MS).find(([, v]) => v === ms)?.[0]) ?? '1d'

/**
 * Resolve a window to concrete instants.
 *
 * A relative window's `to` is rounded DOWN to the interval or to five minutes, whichever is shorter
 * (`freshEnd`), so two requests in the same five minutes produce the same `dash:q:*` cache key while
 * the data still reaches into the current bucket (TW-01): a 30-day window with daily buckets used to
 * end at 00:00 UTC and leave today out. The bucket size is unchanged; the last bucket is partial. An absolute window is
 * used as given and is `cacheable` only when it ended at least one interval ago —
 * a range that is still being written to would otherwise be served stale.
 *
 * The zone is the window's own, else `defaults.timezone` (the VIEWER's browser zone, owner decision D-11,
 * 2026-10-16), else UTC. It is part of the cache token, so two viewers in different zones never share a bucketing.
 */
/**
 * The window before a resolved one: its own length, ending where it starts. History, so it is fixed and fully
 * cacheable; a current calendar period's "so far" end (`periodEnd`) does not carry over.
 */
export function shiftWindowBack(w: ResolvedWindow): ResolvedWindow & { cacheable: true } {
  const from = Date.parse(w.from)
  const span = Date.parse(w.to) - from
  const rest: ResolvedWindow = { ...w }
  delete rest.periodEnd
  return { ...rest, from: new Date(from - span).toISOString(), to: new Date(from).toISOString(), cacheable: true }
}

export function resolveWindow(
  window: TimeWindow,
  now: Date = new Date(),
  defaults: { timezone?: string } = {},
): ResolvedWindow & { cacheable: boolean } {
  const aggregation = window.aggregation ?? 'avg'
  const timezone = window.timezone ?? defaults.timezone ?? 'UTC'

  if (window.mode === 'calendar') {
    const { from, to: end } = calendarBounds(window.period, now.getTime(), timezone)
    // The interval follows the whole period, not the part so far: "today" keeps its 5-minute buckets all day.
    const step = intervalFor(window.interval, end - from)
    const current = isCurrentPeriod(window.period)
    if (!current) {
      // A past period: fixed, finished, fully cacheable.
      return { from: new Date(from).toISOString(), to: new Date(end).toISOString(), interval: intervalName(step), aggregation, timezone, cacheable: true }
    }
    // A current period reads up to now, rounded down to the interval like a relative window (one cache token per
    // interval, so a re-query sees new data once per bucket), and never less than one bucket.
    // Never past now (review 2026-10-17: an hour at a one-hour interval read to the hour's end at 13:01), never empty.
    const to = Math.max(from + MINUTE, freshEnd(now.getTime(), step))
    return {
      from: new Date(from).toISOString(), to: new Date(Math.min(to, end)).toISOString(),
      interval: intervalName(step), aggregation, timezone, cacheable: true, periodEnd: new Date(end).toISOString(),
    }
  }
  if (window.mode === 'relative') {
    const span = relativeMs(window.last)
    if (span === null) throw new AppError(MSG.WINDOW_INVALID, 422, ErrorCode.VALIDATION_ERROR)
    const step = intervalFor(window.interval, span)
    const to = freshEnd(now.getTime(), step)
    // The start is aligned down to the bucket (review 2026-10-17): a source that buckets with date_trunc otherwise
    // returns a partial first bucket that undercounts a sum or a count. The window grows by less than one bucket.
    const from = Math.floor((to - span) / step) * step
    return {
      from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      interval: intervalName(step), aggregation, timezone, cacheable: true,
    }
  }
  const from = Date.parse(window.from)
  const to = Date.parse(window.to)
  if (!(to > from) || to - from > MAX_WINDOW_MS) throw new AppError(MSG.WINDOW_INVALID, 422, ErrorCode.VALIDATION_ERROR)
  const step = intervalFor(window.interval, to - from)
  return {
    from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    interval: intervalName(step), aggregation, timezone,
    cacheable: to <= Math.floor(now.getTime() / step) * step,
  }
}

/**
 * The window a query runs with: a placement's own pin, else the viewer's choice,
 * else the board's saved default. The viewer's `interval` / `aggregation` /
 * `timezone`, when absent, inherit the board's.
 */
export function effectiveWindow(args: {
  pinned?: TimeWindow | null
  viewer?: TimeWindow | null
  board?: TimeWindow | null
}): TimeWindow | null {
  if (args.pinned) return args.pinned
  if (args.viewer) {
    const b = args.board
    return {
      ...args.viewer,
      interval: args.viewer.interval ?? b?.interval,
      aggregation: args.viewer.aggregation ?? b?.aggregation,
      timezone: args.viewer.timezone ?? b?.timezone,
    } as TimeWindow
  }
  return args.board ?? null
}

/** A short, stable token of a resolved window for cache keys (`undefined` = not cacheable). */
export function windowCacheToken(w: ResolvedWindow & { cacheable: boolean }): string | undefined {
  if (!w.cacheable) return undefined
  return `${w.from}|${w.to}|${w.interval}|${w.aggregation}|${w.timezone}`
}

/** `last` presets → label used by the picker and the badge. */
export function describeWindow(w: TimeWindow): string {
  if (w.mode === 'calendar') return `${w.period}${w.soFar ? ' so far' : ''}`
  return w.mode === 'relative' ? `Last ${w.last}` : `${w.from.slice(0, 16)} – ${w.to.slice(0, 16)}`
}
