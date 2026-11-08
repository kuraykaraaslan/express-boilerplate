import { z } from 'zod'

/**
 * The ONE rule predicate. `feature_flags` targeting rules and `form_builder`
 * logic-jump conditions both evaluate through here (architecture audit §0
 * no-functional-duplication vs §5 layering: the shared evaluator lives in
 * `common`, so neither domain imports the other).
 *
 * Comparison is string-coerced on both sides — the historical `feature_flags`
 * semantics, kept byte-identical because live flag evaluation depends on it.
 * `gt`/`lt` are the numeric exception; `isEmpty` tests presence, not equality.
 */
export const RuleOperatorSchema = z.enum([
  'eq', 'neq', 'in', 'nin', 'gt', 'lt', 'contains', 'isEmpty',
])
export type RuleOperator = z.infer<typeof RuleOperatorSchema>

/** `null`/`undefined` compare as the empty string, everything else via String(). */
export function ruleValueToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

/**
 * Pure predicate: does `actual` satisfy `operator` against `values`?
 * No DB, no tenant, no I/O — unit-testable and safe to run per-request.
 *
 * - `eq`/`neq` compare against `values[0]`; `in`/`nin` against the whole list.
 * - `contains` is substring: any of `values` occurring inside `actual`.
 * - `gt`/`lt` parse both sides as numbers; a side that is not a number → false
 *   (an unanswered or non-numeric field never passes a numeric gate).
 * - `isEmpty` ignores `values`: null/undefined/''/empty-array are empty.
 */
export function matchesOperator(operator: RuleOperator, actual: unknown, values: string[]): boolean {
  if (operator === 'isEmpty') {
    if (Array.isArray(actual)) return actual.length === 0
    return ruleValueToString(actual) === ''
  }
  const str = ruleValueToString(actual)
  switch (operator) {
    case 'eq':
      return str === values[0]
    case 'neq':
      return str !== values[0]
    case 'in':
      return values.includes(str)
    case 'nin':
      return !values.includes(str)
    case 'contains':
      return values.some((v) => str.includes(v))
    case 'gt':
    case 'lt': {
      const left = Number(str)
      const right = Number(values[0])
      if (str.trim() === '' || Number.isNaN(left) || Number.isNaN(right)) return false
      return operator === 'gt' ? left > right : left < right
    }
    default:
      return false
  }
}
