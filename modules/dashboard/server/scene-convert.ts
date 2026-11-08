import { z } from 'zod'
import { MAX_EXPRESSION_CHARS, MAX_INPUTS_PER_FIELD, expressionProblems } from './scene-expression'
import { inputDeviceOf, inputValueFrom, type BindingRows, type FieldRead, type LatestByDevice, type MapEntry } from './scene-binding.rows'
import { MAX_TRANSFORM_SCRIPT_CHARS } from './transform.dto'

/**
 * The convert of a scene's fields (dashboard phase 45.3, D45-4 / D45-10), pure: what a binding asks to be converted (`convertPlanOf`), the ONE script the
 * compute frame's Worker runs for all of it (`sceneMapScript`), the strict reading of what it answers (`validateSceneMapOutput`) and the rows with the
 * converted values laid over them (`applyConverted`). The compute host (`ui/compute-host.tsx`, mode `scene-map`) runs it in the phase 35 sandbox; nothing
 * here touches a DOM, a Worker or the network, and nothing here evaluates text.
 *
 * Why a generated script and not `new Function` in the Worker (SH2-1): the compute frame's policy has no `'unsafe-eval'` (`compute-shell.ts`, pinned by
 * `compute-frame.route.test.ts`), and a Worker made from a Blob inherits it, so `new Function` throws there. What a Worker CAN do is parse a script it is
 * given as a Blob, which is how every phase 35 script runs: the expressions (already judged by `expressionProblems`, which accepts only one JavaScript
 * expression over `value`, `row` and `now`) are placed one by one as arrow bodies in a module the host hands the shell exactly as it hands a transform
 * script. They are compiled ONCE per script by the Worker's own parse (memoised for as long as the Worker lives: one Worker per distinct expression set),
 * and a run only calls them. The policy of the frame stays as it was.
 */

/** Per expression, a call that took longer is reported as too slow and its value dropped (measured in the Worker; a loop cannot be interrupted, the batch budget ends it). */
export const SCENE_MAP_EXPRESSION_MS = 5
/** The whole batch's budget in the Worker (the shell terminates the Worker past it); one binding is one batch. */
export const SCENE_MAP_BATCH_MS = 50
/** The most DISTINCT expressions one script carries: 250 of 200 characters and their wrapping stay under the compute script cap (64 KiB). */
export const MAX_SCENE_EXPRESSIONS = 250
/** The most calls (a field of a symbol each) one batch carries. */
export const MAX_SCENE_CALLS = 2_000
/** The longest text a result may be. */
export const MAX_RESULT_TEXT = 200
/** A raw text value handed to an expression is cut at this length (telemetry text is short; a long one is not a state). */
export const MAX_INPUT_TEXT = 1_000
/** The serialised batch result is at most this many characters (each of 2 000 results is a few dozen bytes). */
export const MAX_SCENE_OUTPUT_CHARS = 262_144

/**
 * The binding part the plan reads (`BindingRows` of `scene-binding.rows.ts`: the fields' `script`, `key` and `inputs`, and the role table that says which
 * device an input without a device of its own is read from). `devices` may be left out by a caller whose inputs all name their device.
 */
export interface ConvertBinding {
  devices?: Readonly<Record<string, string>>
  map: Readonly<Record<string, { deviceId?: string; element?: string; fields?: Readonly<Record<string, { script?: string; key?: string; deviceId?: string; inputs?: Readonly<Record<string, { deviceId?: string; key: string }>> }>> }>>
}

/** One named input as the plan resolved it (slice 16): the device it is read from (lower-cased; undefined when the binding names none) and the key. */
export interface ConvertInput {
  name: string
  deviceId: string | undefined
  key: string
}

/** One function of the generated script: an expression and the input names it reads, in the order they are handed over. */
export interface ExprFn {
  expr: string
  inputs: string[]
}

/**
 * One field to convert: the scene key, the field, the expression and its named inputs (slice 16). `id` is `<sceneKey>.<field>` (a field name has no dot,
 * so it splits at the last one). `primary` says the field has a raw value of its own (`value`: a key of its own, or no inputs at all so the row's value is it);
 * an item that reads inputs and no key is an expression over the inputs alone, called with `value` null.
 */
export interface ConvertItem {
  id: string
  key: string
  field: string
  expr: string
  primary: boolean
  inputs: ConvertInput[]
}

/** What a binding asks to convert, sorted by id, and the fields that cannot be (a text that is not an expression, or past the caps), by id with the plain reason. */
export interface ConvertPlan {
  items: ConvertItem[]
  /** The distinct functions in script order (`items[i]` uses the one whose `expr` and input names match); two fields with one formula and the same input names share one. */
  exprs: ExprFn[]
  /** Fields whose expression is refused, with the sentence that says why (shown by the panel, and the field keeps its raw value). */
  refused: Record<string, string>
}

export const EMPTY_PLAN: ConvertPlan = Object.freeze({ items: [], exprs: [], refused: {} }) as ConvertPlan

/** The identity of a function in a script: its text and its input names. */
export const fnKey = (fn: ExprFn): string => JSON.stringify([fn.expr, fn.inputs])

/** `exprs` as a script takes it: a bare text is a function with no inputs. */
export const fnOf = (e: string | ExprFn): ExprFn => (typeof e === 'string' ? { expr: e, inputs: [] } : { expr: e.expr, inputs: [...e.inputs] })

/** The plan of a binding: every field with a `script`, judged by `expressionProblems` with its input names. An empty plan (the common case) is the shared `EMPTY_PLAN`. */
export function convertPlanOf(binding: ConvertBinding | null | undefined): ConvertPlan {
  if (!binding) return EMPTY_PLAN
  const rows: BindingRows = { devices: binding.devices ?? {}, map: binding.map as BindingRows['map'] }
  const items: ConvertItem[] = []
  const refused: Record<string, string> = {}
  const fns = new Map<string, ExprFn>()
  for (const key of Object.keys(binding.map).sort()) {
    const entry = binding.map[key]
    const fields = entry?.fields
    if (!fields) continue
    for (const field of Object.keys(fields).sort()) {
      const read = fields[field]
      const expr = read?.script
      if (expr === undefined) continue
      const id = `${key}.${field}`
      const names = Object.keys(read.inputs ?? {}).sort()
      const problems = names.length > MAX_INPUTS_PER_FIELD ? [`a formula reads at most ${MAX_INPUTS_PER_FIELD} inputs`] : expressionProblems(expr, names)
      if (problems.length) { refused[id] = `The formula is not valid: ${problems[0]}`; continue }
      const fn: ExprFn = { expr, inputs: names }
      const fk = fnKey(fn)
      if (!fns.has(fk) && fns.size >= MAX_SCENE_EXPRESSIONS) { refused[id] = `This scene has more than ${MAX_SCENE_EXPRESSIONS} different formulas`; continue }
      if (items.length >= MAX_SCENE_CALLS) { refused[id] = `This scene converts more than ${MAX_SCENE_CALLS} fields`; continue }
      fns.set(fk, fn)
      const inputs = names.map((name): ConvertInput => {
        const input = read.inputs![name]
        return { name, deviceId: inputDeviceOf(rows, key, entry as MapEntry, read as FieldRead, input), key: input.key }
      })
      // a field with a key of its own, or one with no inputs at all (its raw value comes from the row, e.g. the element row), is converted FROM its raw value;
      // only a field that reads inputs and no key is an expression over the inputs alone
      items.push({ id, key, field, expr, primary: read.key !== undefined || names.length === 0, inputs })
    }
  }
  if (items.length === 0 && Object.keys(refused).length === 0) return EMPTY_PLAN
  return { items, exprs: [...fns.values()].sort((a, b) => (fnKey(a) < fnKey(b) ? -1 : 1)), refused }
}

/**
 * The module the Worker parses for a set of expressions (what `computeInit` carries as `script`): `F[n]` is the n-th expression compiled once, and the
 * default export, which the runner calls per `computeRun`, answers `{ results: [{ ok: true, value } | { ok: false, error }] }` in the order of the
 * `items` it was given (`{ x, value, row, now }`, `x` the index into `F`). One expression that throws, is slow or answers a non-scalar fails ALONE.
 * Only text that passed `expressionProblems` may be given (this throws otherwise: a script is never built from an unjudged text). Pure; the output is
 * a function of the list, so the host can key a Worker by it.
 */
export function sceneMapScript(exprs: readonly (string | ExprFn)[]): string {
  if (exprs.length > MAX_SCENE_EXPRESSIONS) throw new Error(`at most ${MAX_SCENE_EXPRESSIONS} expressions`)
  const list = exprs.map(fnOf)
  for (const f of list) if (expressionProblems(f.expr, f.inputs).length) throw new Error('an expression was not judged')
  // a function with named inputs (slice 16) reads them off the call's `inputs` object into constants of those names, so the expression names them bare;
  // the names passed `inputNameProblems`, so none is a reserved word and none shadows value, row or now
  const fns = list.map((f) => (f.inputs.length === 0
    ? `(value, row, now) => (${f.expr}\n)`
    : `(value, row, now, $i) => { ${f.inputs.map((n) => `const ${n} = $i && Object.hasOwn($i, ${JSON.stringify(n)}) ? $i[${JSON.stringify(n)}] : null;`).join(' ')} return (${f.expr}\n); }`)).join(',\n')
  const script = `// scene-map (dashboard phase 45.3): generated, one function per distinct expression
const F = [
${fns}
];
const TEXT = ${MAX_RESULT_TEXT};
const SLOW = ${SCENE_MAP_EXPRESSION_MS};
const BAD = 'The formula must give a number, true/false or text';
export default function sceneMap(input) {
  const results = [];
  const items = input && Array.isArray(input.items) ? input.items : [];
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const f = it && typeof it.x === 'number' ? F[it.x] : undefined;
    if (typeof f !== 'function') { results.push({ ok: false, error: 'The formula is not loaded' }); continue; }
    const t0 = performance.now();
    try {
      const v = f(it.value, it.row, it.now, it.inputs);
      if (performance.now() - t0 > SLOW) results.push({ ok: false, error: 'The formula took too long' });
      else if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= TEXT)) results.push({ ok: true, value: v });
      else results.push({ ok: false, error: BAD });
    } catch (e) {
      results.push({ ok: false, error: String(e && e.message !== undefined ? e.message : e).slice(0, TEXT) });
    }
  }
  return { results };
}
`
  if (script.length > MAX_TRANSFORM_SCRIPT_CHARS) throw new Error('the script is over the compute script cap')
  return script
}

/** One call of a batch as the host posts it: the expression's index in the script, the field's raw value, the symbol's raw row, the clock and the named inputs' values (slice 16). */
export interface SceneMapCall {
  x: number
  value: unknown
  row: Record<string, unknown>
  now: number
  inputs?: Record<string, boolean | number | string | null>
}

/** A result of one call. */
export type SceneMapResult = { ok: true; value: boolean | number | string } | { ok: false; error: string }

const ResultSchema = z.union([
  z.object({ ok: z.literal(true), value: z.union([z.boolean(), z.number().finite(), z.string().max(MAX_RESULT_TEXT)]) }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(MAX_RESULT_TEXT) }).strict(),
])

export type SceneMapVerdict =
  | { ok: true; results: SceneMapResult[] }
  | { ok: false; error: { code: 'invalid'; message: string } }

/**
 * What the Worker answered, as the host reads it: JSON text, at most `MAX_SCENE_OUTPUT_CHARS`, exactly `{ results: [...] }` with one entry per call
 * asked, each `{ ok: true, value }` with a boolean, a finite number or a text of at most `MAX_RESULT_TEXT` characters, or `{ ok: false, error }`. Anything
 * else (an object or an array as a value, `null`, a missing or extra result, an unknown key) makes the whole answer `invalid`: nothing partial is used.
 */
export function validateSceneMapOutput(json: unknown, count: number): SceneMapVerdict {
  const invalid = (message: string): SceneMapVerdict => ({ ok: false, error: { code: 'invalid', message } })
  if (typeof json !== 'string') return invalid('the result is not data')
  if (json.length > MAX_SCENE_OUTPUT_CHARS) return invalid('the result is too large')
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return invalid('the result is not JSON') }
  const parsed = z.object({ results: z.array(ResultSchema).length(count) }).strict().safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return invalid(`${issue?.path.map(String).join('.') || 'results'}: ${issue?.message ?? 'not valid'}`.slice(0, 200))
  }
  return { ok: true, results: parsed.data.results }
}

const isScalar = (v: unknown): v is boolean | number | string | null => v === null || typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
const IDENTITY_COLUMNS: ReadonlySet<string> = new Set(['id', 'element', 'deviceId'])

/** A raw value as an expression gets it: a scalar (a text cut at `MAX_INPUT_TEXT`), else null (an object, a non-finite number or nothing is not a reading). */
export function inputValueOf(v: unknown): boolean | number | string | null {
  if (typeof v === 'string') return v.length > MAX_INPUT_TEXT ? v.slice(0, MAX_INPUT_TEXT) : v
  return isScalar(v) ? v : null
}

/** The row an expression gets as `row`: the scalar columns of the assembled row except its identity (`id`, `element`, `deviceId`), a text cut at `MAX_INPUT_TEXT`. */
export function inputRowOf(row: Readonly<Record<string, unknown>>): Record<string, boolean | number | string | null> {
  const out: Record<string, boolean | number | string | null> = {}
  for (const k of Object.keys(row)) {
    if (IDENTITY_COLUMNS.has(k) || k === '__proto__' || !isScalar(row[k])) continue
    out[k] = inputValueOf(row[k])
  }
  return out
}

/** A call of a plan: which item it is for, what it is asked with. */
export interface PlannedCall extends SceneMapCall {
  item: ConvertItem
}

/** The named inputs' values of an item from the latest keys the card read (slice 16): a scalar each, null for one not sent or not read. */
export function inputsOf(item: ConvertItem, latest: LatestByDevice | undefined): Record<string, boolean | number | string | null> {
  const out: Record<string, boolean | number | string | null> = {}
  for (const i of item.inputs) {
    const point = inputValueFrom(latest, i.deviceId, i.key)
    out[i.name] = point === undefined ? null : inputValueOf(point.value)
  }
  return out
}

/** The identity of what an item was asked with beside `value` (the inputs' values): what a result is matched against before it is laid over a row. */
export const inputsKeyOf = (inputs: Readonly<Record<string, unknown>> | undefined): string => (inputs && Object.keys(inputs).length > 0 ? JSON.stringify(inputs) : '')

/**
 * The calls a batch makes for these rows: for each item of the plan, the row under its scene key (`id`) that has the field with a value. A field with no
 * value is not converted (never invented: `!undefined` would be `true`), a row that is not there asks nothing. An expression-only field (no key of its
 * own, slice 16) is called when at least one of its inputs has a value, with `value` null. `now` is the host's clock; `latest` the latest keys the card
 * read, where the inputs' values come from.
 */
export function callsOf(plan: ConvertPlan, rows: ReadonlyArray<Readonly<Record<string, unknown>>>, now: number, latest?: LatestByDevice): PlannedCall[] {
  if (plan.items.length === 0) return []
  const byKey = new Map<string, Readonly<Record<string, unknown>>>()
  for (const r of rows) {
    const id = String(r.id ?? '')
    if (!byKey.has(id)) byKey.set(id, r)
  }
  const index = new Map(plan.exprs.map((e, i) => [fnKey(e), i]))
  const calls: PlannedCall[] = []
  for (const item of plan.items) {
    const row = byKey.get(item.key)
    if (!row) continue
    const x = index.get(fnKey({ expr: item.expr, inputs: item.inputs.map((i) => i.name) }))
    if (x === undefined) continue
    const inputs = item.inputs.length > 0 ? inputsOf(item, latest) : undefined
    const hasRaw = Object.hasOwn(row, item.field) && row[item.field] !== undefined && row[item.field] !== null
    if (item.primary ? !hasRaw : !(inputs && Object.values(inputs).some((v) => v !== null))) continue
    calls.push({ item, x, value: hasRaw ? inputValueOf(row[item.field]) : null, row: inputRowOf(row), now, ...(inputs ? { inputs } : {}) })
  }
  return calls
}

/** What a converted field holds beside the raw value it came from, so a result is applied only to the value it was computed from. */
export interface ConvertedValue {
  /** The raw value the expression was given. */
  from: boolean | number | string | null
  /** The inputs' values it was given (`inputsKeyOf`), '' for none. */
  inputs?: string
  value: boolean | number | string
}

/**
 * The rows with the converted values laid over the raw ones: for each item with a result that was computed FROM the row's current raw value (and, for an
 * expression with inputs, from the inputs' current values in `latest`), the field is the result (nothing else is added to a row: the symbol reads the
 * converted value). A failed, missing or stale result (computed from another raw value) leaves the raw value. Returns the same array when nothing changed
 * (a card then does not redraw), and copies only the rows that changed.
 */
export function applyConverted(
  rows: ReadonlyArray<Record<string, unknown>>,
  plan: ConvertPlan,
  converted: Readonly<Record<string, ConvertedValue>>,
  latest?: LatestByDevice,
): Array<Record<string, unknown>> {
  if (plan.items.length === 0) return rows as Array<Record<string, unknown>>
  const byKey = new Map<string, ConvertItem[]>()
  for (const item of plan.items) {
    const list = byKey.get(item.key)
    if (list) list.push(item)
    else byKey.set(item.key, [item])
  }
  let changed = false
  const out = rows.map((r) => {
    const items = byKey.get(String(r.id ?? ''))
    if (!items) return r
    let next: Record<string, unknown> | null = null
    for (const item of items) {
      const c = Object.hasOwn(converted, item.id) ? converted[item.id] : undefined
      if (!c) continue
      const hasRaw = Object.hasOwn(r, item.field) && r[item.field] !== undefined && r[item.field] !== null
      if (item.primary ? (!hasRaw || inputValueOf(r[item.field]) !== c.from) : hasRaw && inputValueOf(r[item.field]) !== c.from) continue
      if (item.inputs.length > 0 && inputsKeyOf(inputsOf(item, latest)) !== (c.inputs ?? '')) continue
      next ??= { ...r }
      next[item.field] = c.value
    }
    if (next) changed = true
    return next ?? r
  })
  return changed ? out : (rows as Array<Record<string, unknown>>)
}

/**
 * A failure as a person reads it (the panel's preview and the card's notes): a syntax or runtime message of the Worker, the budget, or a result that is
 * not a scalar. English text; the UI shows it as given (the dictionaries carry the fixed sentences, `dashboard.sceneConvert.*`).
 */
export type ConvertErrorKind = 'syntax' | 'timeout' | 'type' | 'throw' | 'unavailable' | 'invalid'
export interface ConvertError { kind: ConvertErrorKind; message: string }

/** Names what a Worker reported about one expression. `The formula took too long` and `must give a number…` are the Worker's own fixed sentences. */
export function convertErrorOf(raw: string): ConvertError {
  if (/took too long|ran past its|did not answer in time/i.test(raw)) return { kind: 'timeout', message: 'The formula took too long' }
  if (/must give a number/i.test(raw)) return { kind: 'type', message: 'The formula must give a number, true/false or text' }
  return { kind: 'throw', message: `The formula could not be calculated: ${raw.slice(0, MAX_RESULT_TEXT)}` }
}

export { MAX_EXPRESSION_CHARS }
