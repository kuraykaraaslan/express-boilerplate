import { z } from 'zod'

/**
 * Typed probe assertions (observability phase 09.4).
 *
 * One pure evaluator turns "what came back" into a verdict. HTTP checks and every STEPS step use it, so a rule means the same
 * thing wherever it is written. Nothing here performs I/O.
 *
 * What it deliberately does NOT do:
 *  - **Echo response content.** A failure names the rule and the path, never the value the server returned (numbers and booleans
 *    excepted): the reason lands in the checks list that every monitor reader can open, and a response body can carry secrets.
 *  - **Run unbounded patterns.** Node has no linear-time regex engine here, so a pattern is length-capped, refused when it has the
 *    classic nested-quantifier or back-reference shapes, and applied to a capped prefix of the body. That is a mitigation, not a proof;
 *    swapping in a linear-time engine is the real fix and is recorded in the phase file.
 *  - **Grow into a query language.** JSONPath is the dotted / bracketed subset: `$.a.b[0]` and `$['a-b']`. Wildcards, filters and
 *    recursive descent are rejected when the monitor is saved.
 */

export const MAX_ASSERTIONS = 20
export const MAX_REGEX_LENGTH = 200
/** Only this much of a body is ever matched; the rest is ignored. */
export const MAX_MATCH_CHARS = 100_000
export const MAX_JSONPATH_DEPTH = 20

const Severity = z.enum(['DOWN', 'DEGRADED'])

export const AssertionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), in: z.array(z.number().int().min(100).max(599)).min(1).max(20), severity: Severity.optional() }),
  z.object({
    kind: z.literal('header'), name: z.string().min(1).max(100),
    op: z.enum(['exists', 'equals', 'contains', 'matches']), value: z.string().max(300).optional(), severity: Severity.optional(),
  }),
  z.object({
    kind: z.literal('body'), op: z.enum(['contains', 'notContains', 'matches']), value: z.string().min(1).max(MAX_REGEX_LENGTH * 2), severity: Severity.optional(),
  }),
  z.object({
    kind: z.literal('json'), path: z.string().min(1).max(200),
    op: z.enum(['exists', 'equals', 'contains', 'gt', 'lt', 'between']),
    value: z.union([z.string().max(300), z.number(), z.boolean()]).optional(), max: z.number().optional(), severity: Severity.optional(),
  }),
  z.object({ kind: z.literal('latency'), maxMs: z.number().int().positive().max(600_000), severity: Severity.optional() }),
  z.object({ kind: z.literal('size'), maxBytes: z.number().int().positive().max(100_000_000), severity: Severity.optional() }),
])
export type Assertion = z.infer<typeof AssertionSchema>

export const AssertionListSchema = z.array(AssertionSchema).max(MAX_ASSERTIONS).superRefine((list, ctx) => {
  list.forEach((a, i) => {
    const problem = assertionProblem(a)
    if (problem) ctx.addIssue({ code: 'custom', path: [i], message: problem })
  })
})

/** What a probe saw. `body` is read lazily by the caller only when an assertion needs it. */
export interface AssertionContext {
  statusCode: number | null
  header(name: string): string | null
  body: string | null
  sizeBytes: number | null
  latencyMs: number | null
}

export interface AssertionResult {
  /** Failures that make the sample DOWN, one short reason each. */
  down: string[]
  /** Failures that only make it DEGRADED (a latency budget, by default). */
  degraded: string[]
}

// ---- patterns ------------------------------------------------------------------------------------------------------------

/** A group that contains an unbounded quantifier and is itself quantified: `(a+)+`, `(.*)*`, `(a|b*)+`. */
const NESTED_QUANTIFIER = /\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,\d*\})/
const BACKREFERENCE = /\\[1-9]|\\k</

/** A compiled pattern, or a short reason it was refused. Never throws. */
export function compilePattern(pattern: string): { re: RegExp } | { error: string } {
  if (pattern.length > MAX_REGEX_LENGTH) return { error: `pattern longer than ${MAX_REGEX_LENGTH} characters` }
  if (NESTED_QUANTIFIER.test(pattern)) return { error: 'pattern has a nested quantifier' }
  if (BACKREFERENCE.test(pattern)) return { error: 'pattern uses a back-reference' }
  try {
    return { re: new RegExp(pattern) }
  } catch {
    return { error: 'pattern is not a valid regular expression' }
  }
}

// ---- JSONPath subset -----------------------------------------------------------------------------------------------------

export type PathSegment = string | number

/** `$.a.b[0]`, `$['a-b']`, `$.a["b"]`. Anything else (`*`, `..`, `?()`, slices) returns null. */
export function parseJsonPath(path: string): PathSegment[] | null {
  if (!path.startsWith('$')) return null
  const segments: PathSegment[] = []
  let i = 1
  while (i < path.length) {
    const c = path[i]
    if (c === '.') {
      const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(path.slice(i + 1))
      if (!m) return null
      segments.push(m[0])
      i += 1 + m[0].length
    } else if (c === '[') {
      const rest = path.slice(i)
      const idx = /^\[(\d{1,6})\]/.exec(rest)
      const key = /^\[(?:'([^'\\]{1,100})'|"([^"\\]{1,100})")\]/.exec(rest)
      if (idx) { segments.push(Number(idx[1])); i += idx[0].length }
      else if (key) { segments.push(key[1] ?? key[2]); i += key[0].length }
      else return null
    } else {
      return null
    }
    if (segments.length > MAX_JSONPATH_DEPTH) return null
  }
  return segments
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function readJsonPath(root: unknown, segments: PathSegment[]): { found: boolean; value?: unknown } {
  let cur: unknown = root
  for (const seg of segments) {
    if (cur === null || typeof cur !== 'object') return { found: false }
    if (typeof seg === 'string') {
      // Own properties only: a path must not walk into the prototype chain.
      if (FORBIDDEN_KEYS.has(seg) || !Object.prototype.hasOwnProperty.call(cur, seg)) return { found: false }
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      if (!Array.isArray(cur) || seg >= cur.length) return { found: false }
      cur = cur[seg]
    }
  }
  return { found: true, value: cur }
}

// ---- validation ----------------------------------------------------------------------------------------------------------

/** A reason this assertion can never be evaluated, or null. Checked when the monitor is saved so a typo fails loudly there. */
export function assertionProblem(a: Assertion): string | null {
  switch (a.kind) {
    case 'header':
      if (a.op !== 'exists' && a.value === undefined) return 'header assertion needs a value'
      if (a.op === 'matches' && a.value !== undefined) { const c = compilePattern(a.value); if ('error' in c) return c.error }
      return null
    case 'body':
      if (a.op === 'matches') { const c = compilePattern(a.value); if ('error' in c) return c.error }
      return null
    case 'json': {
      if (!parseJsonPath(a.path)) return 'unsupported JSONPath (only $.a.b[0] and $[\'a\'] are allowed)'
      if (a.op !== 'exists' && a.value === undefined) return 'json assertion needs a value'
      if ((a.op === 'gt' || a.op === 'lt' || a.op === 'between') && typeof a.value !== 'number') return `${a.op} needs a number`
      if (a.op === 'between' && a.max === undefined) return 'between needs a max'
      return null
    }
    default:
      return null
  }
}

// ---- evaluation ----------------------------------------------------------------------------------------------------------

/** Does any assertion need the response body? Lets the caller skip reading it. */
export function needsBody(list: readonly Assertion[]): boolean {
  return list.some((a) => a.kind === 'body' || a.kind === 'json')
}

function severityOf(a: Assertion): 'DOWN' | 'DEGRADED' {
  return a.severity ?? (a.kind === 'latency' ? 'DEGRADED' : 'DOWN')
}

function matchHeader(a: Extract<Assertion, { kind: 'header' }>, got: string | null): string | null {
  if (a.op === 'exists') return got === null ? `header ${a.name} is missing` : null
  if (got === null) return `header ${a.name} is missing`
  const want = a.value ?? ''
  if (a.op === 'equals') return got === want ? null : `header ${a.name} did not equal the expected value`
  if (a.op === 'contains') return got.includes(want) ? null : `header ${a.name} did not contain the expected text`
  const c = compilePattern(want)
  if ('error' in c) return `header ${a.name}: ${c.error}`
  return c.re.test(got.slice(0, 2000)) ? null : `header ${a.name} did not match the expected pattern`
}

function matchBody(a: Extract<Assertion, { kind: 'body' }>, body: string | null): string | null {
  const text = (body ?? '').slice(0, MAX_MATCH_CHARS)
  if (a.op === 'contains') return text.includes(a.value) ? null : 'body did not contain expected marker'
  if (a.op === 'notContains') return text.includes(a.value) ? 'body contained a forbidden marker' : null
  const c = compilePattern(a.value)
  if ('error' in c) return `body: ${c.error}`
  return c.re.test(text) ? null : 'body did not match the expected pattern'
}

function matchJson(a: Extract<Assertion, { kind: 'json' }>, doc: { ok: true; value: unknown } | { ok: false }): string | null {
  if (!doc.ok) return 'response is not JSON'
  const segments = parseJsonPath(a.path)
  if (!segments) return `unsupported JSONPath ${a.path}`
  const found = readJsonPath(doc.value, segments)
  if (a.op === 'exists') return found.found ? null : `${a.path} does not exist`
  if (!found.found) return `${a.path} does not exist`
  const got = found.value
  switch (a.op) {
    case 'equals':
      return got === a.value ? null : `${a.path} did not equal the expected value`
    case 'contains':
      if (typeof got === 'string') return got.includes(String(a.value)) ? null : `${a.path} did not contain the expected text`
      if (Array.isArray(got)) return got.some((x) => x === a.value) ? null : `${a.path} did not contain the expected item`
      return `${a.path} is not a string or array`
    case 'gt':
    case 'lt':
    case 'between': {
      if (typeof got !== 'number') return `${a.path} is not a number`
      const v = a.value as number
      if (a.op === 'gt') return got > v ? null : `${a.path} is ${got}, expected more than ${v}`
      if (a.op === 'lt') return got < v ? null : `${a.path} is ${got}, expected less than ${v}`
      return got >= v && got <= (a.max as number) ? null : `${a.path} is ${got}, expected ${v}..${a.max}`
    }
    default:
      return null
  }
}

export function evaluateAssertions(list: readonly Assertion[], ctx: AssertionContext): AssertionResult {
  const result: AssertionResult = { down: [], degraded: [] }
  let doc: { ok: true; value: unknown } | { ok: false } | null = null
  const json = (): { ok: true; value: unknown } | { ok: false } => {
    if (doc) return doc
    try { doc = { ok: true, value: JSON.parse((ctx.body ?? '').slice(0, MAX_MATCH_CHARS * 10)) } } catch { doc = { ok: false } }
    return doc
  }

  for (const a of list) {
    let failure: string | null = null
    switch (a.kind) {
      case 'status':
        if (ctx.statusCode === null || !a.in.includes(ctx.statusCode)) failure = `unexpected status ${ctx.statusCode ?? 'none'}`
        break
      case 'header': failure = matchHeader(a, ctx.header(a.name)); break
      case 'body': failure = matchBody(a, ctx.body); break
      case 'json': failure = matchJson(a, json()); break
      case 'latency':
        if (ctx.latencyMs !== null && ctx.latencyMs > a.maxMs) failure = `response time ${ctx.latencyMs}ms is over the ${a.maxMs}ms budget`
        break
      case 'size':
        if (ctx.sizeBytes !== null && ctx.sizeBytes > a.maxBytes) failure = `response size ${ctx.sizeBytes} bytes is over ${a.maxBytes}`
        break
    }
    if (failure) (severityOf(a) === 'DOWN' ? result.down : result.degraded).push(failure)
  }
  return result
}

/** The two legacy single-purpose columns, read as assertions. `expectedStatus` is handled by the HTTP check itself (its default is "any 2xx/3xx"). */
export function legacyAssertions(monitor: { expectedBodyContains?: string | null }): Assertion[] {
  return monitor.expectedBodyContains
    ? [{ kind: 'body', op: 'contains', value: monitor.expectedBodyContains }]
    : []
}

/** Parse the stored jsonb defensively: a row written by another version must not end a sweep. Invalid entries are dropped. */
export function readStoredAssertions(raw: unknown): Assertion[] {
  if (!Array.isArray(raw)) return []
  const out: Assertion[] = []
  for (const item of raw.slice(0, MAX_ASSERTIONS)) {
    const parsed = AssertionSchema.safeParse(item)
    if (parsed.success && !assertionProblem(parsed.data)) out.push(parsed.data)
  }
  return out
}
