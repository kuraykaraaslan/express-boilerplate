import { z } from 'zod'
import { compilePattern } from './uptime.assertions'
import { MatcherOpEnum, type MatcherOp } from './alert.enums'

/**
 * Label matchers, the whole matching language of the alert pipeline (observability phase 11): equality, inequality, regex and negated
 * regex over a flat string map. No boolean algebra, no functions. A route or a silence is a LIST of matchers that must ALL hold.
 *
 * Regular expressions follow Prometheus: they are anchored (`^(?:pattern)$`) and refused when they could backtrack badly
 * (`compilePattern`, the same guard the monitor assertions use).
 */

export const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/
export const MAX_MATCHERS = 20
export const MAX_LABELS = 40
export const MAX_LABEL_VALUE = 500

export const MatcherSchema = z.object({
  label: z.string().regex(LABEL_NAME),
  op: MatcherOpEnum,
  value: z.string().max(MAX_LABEL_VALUE),
})
export type Matcher = z.infer<typeof MatcherSchema>

export const MatcherListSchema = z.array(MatcherSchema).max(MAX_MATCHERS).superRefine((list, ctx) => {
  list.forEach((m, i) => {
    if (m.op === '=~' || m.op === '!~') {
      const c = compilePattern(m.value)
      if ('error' in c) ctx.addIssue({ code: 'custom', path: [i, 'value'], message: c.error })
    }
  })
})

export type Labels = Readonly<Record<string, string>>

/** Does one matcher hold for these labels? A missing label reads as the empty string, as in Prometheus. */
export function matchOne(m: Matcher, labels: Labels): boolean {
  const have = labels[m.label] ?? ''
  switch (m.op as MatcherOp) {
    case '=': return have === m.value
    case '!=': return have !== m.value
    case '=~':
    case '!~': {
      const c = compilePattern(`^(?:${m.value})$`)
      if ('error' in c) return false // an unusable pattern never matches; a negated one therefore never "does not match" either
      const hit = c.re.test(have.slice(0, MAX_LABEL_VALUE))
      return m.op === '=~' ? hit : !hit
    }
    default: return false
  }
}

/** ALL matchers must hold. An empty list matches everything (the catch-all route). */
export function matchesAll(matchers: readonly Matcher[], labels: Labels): boolean {
  return matchers.every((m) => matchOne(m, labels))
}

/** Parse the stored jsonb defensively; invalid entries make the whole list never match rather than match everything. */
export function readStoredMatchers(raw: unknown): Matcher[] | null {
  const r = MatcherListSchema.safeParse(raw ?? [])
  return r.success ? r.data : null
}

/** Normalise incoming labels: strings only, valid names, bounded. Anything else is dropped, never thrown on (an external sender is untrusted). */
export function sanitizeLabels(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_LABELS) break
    if (!LABEL_NAME.test(k) || k === '__proto__') continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v).slice(0, MAX_LABEL_VALUE)
  }
  return out
}
