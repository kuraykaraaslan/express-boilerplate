import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { BoardParamKeySchema, isParamRef } from './board-window'

/**
 * Board key filters (docs/phases/07-dashboard/36, 36.7): Legacy's dashboard filters on our vocabulary. A filter is
 * named on the board and bound next to an alias (`{ "$alias": "devices", "filter": "hot" }`); the dashboard evaluates
 * it here over the values a module reads (`DashboardEntityType.readKeys`). Key filters are joined by the filter's
 * `operation` (TB's `keyFiltersOperation`, default AND); predicates
 * inside one key filter by its `operation`. A value is a literal or `{ "$param": key }` (TB's editable filter).
 *
 * Pure: schemas, references and the evaluator. No module is read here.
 */

export const MAX_BOARD_FILTERS = 16
export const MAX_KEY_FILTERS = 8
export const MAX_PREDICATES = 4
export const MAX_FILTER_VALUES = 50
export const MAX_FILTER_TEXT = 200

export const KEY_FILTER_KEY_TYPES = ['field', 'attribute', 'telemetry'] as const
export type KeyFilterKeyType = (typeof KEY_FILTER_KEY_TYPES)[number]
export const ATTRIBUTE_SCOPES = ['client', 'shared', 'server', 'any'] as const
export type AttributeScope = (typeof ATTRIBUTE_SCOPES)[number]
export const KEY_FILTER_VALUE_TYPES = ['string', 'number', 'boolean', 'datetime'] as const
export type KeyFilterValueType = (typeof KEY_FILTER_VALUE_TYPES)[number]
export const KEY_FILTER_OPS = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'set', 'unset', 'true', 'false',
  'startsWith', 'endsWith', 'contains', 'notContains',
] as const
export type KeyFilterOp = (typeof KEY_FILTER_OPS)[number]

/** The ops each value type takes (the spec's list). */
export const OPS_BY_VALUE_TYPE: Record<KeyFilterValueType, readonly KeyFilterOp[]> = {
  string: ['eq', 'ne', 'startsWith', 'endsWith', 'contains', 'notContains', 'in', 'notIn', 'set', 'unset'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'notIn', 'set', 'unset'],
  boolean: ['eq', 'ne', 'true', 'false', 'set', 'unset'],
  datetime: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'set', 'unset'],
}
const NEEDS_VALUE: ReadonlySet<KeyFilterOp> = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'startsWith', 'endsWith', 'contains', 'notContains'])
const NEEDS_VALUES: ReadonlySet<KeyFilterOp> = new Set(['in', 'notIn'])

const KeyNameSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid key name')
const FilterValueSchema = z.union([
  z.string().max(MAX_FILTER_TEXT), z.number().finite(), z.boolean(),
  z.object({ $param: BoardParamKeySchema }).strict(),
])
export type FilterValue = z.infer<typeof FilterValueSchema>

const PredicateSchema = z.object({
  op: z.enum(KEY_FILTER_OPS),
  value: FilterValueSchema.optional(),
  to: FilterValueSchema.optional(),
  values: z.array(z.string().max(MAX_FILTER_TEXT)).max(MAX_FILTER_VALUES).optional(),
  ignoreCase: z.boolean().optional(),
}).strict()
export type KeyFilterPredicate = z.infer<typeof PredicateSchema>

export const KeyFilterSchema = z.object({
  key: z.object({
    type: z.enum(KEY_FILTER_KEY_TYPES),
    name: KeyNameSchema,
    scope: z.enum(ATTRIBUTE_SCOPES).optional(),
  }).strict(),
  valueType: z.enum(KEY_FILTER_VALUE_TYPES),
  operation: z.enum(['and', 'or']),
  predicates: z.array(PredicateSchema).min(1).max(MAX_PREDICATES),
}).strict().superRefine((kf, ctx) => {
  if (kf.key.scope !== undefined && kf.key.type !== 'attribute') ctx.addIssue({ code: 'custom', message: 'Only an attribute has a scope', path: ['key', 'scope'] })
  kf.predicates.forEach((p, i) => {
    if (!OPS_BY_VALUE_TYPE[kf.valueType].includes(p.op)) ctx.addIssue({ code: 'custom', message: `'${p.op}' does not apply to a ${kf.valueType}`, path: ['predicates', i, 'op'] })
    if (NEEDS_VALUE.has(p.op) && p.value === undefined) ctx.addIssue({ code: 'custom', message: 'This comparison needs a value', path: ['predicates', i, 'value'] })
    if (p.op === 'between' && p.to === undefined) ctx.addIssue({ code: 'custom', message: 'Between needs an upper value', path: ['predicates', i, 'to'] })
    if (NEEDS_VALUES.has(p.op) && !p.values?.length) ctx.addIssue({ code: 'custom', message: 'This comparison needs a list of values', path: ['predicates', i, 'values'] })
  })
})
export type KeyFilter = z.infer<typeof KeyFilterSchema>

export const BoardFilterSchema = z.object({
  key: BoardParamKeySchema,
  name: z.string().trim().min(1).max(80),
  /** How the key filters join (TB's `keyFiltersOperation`); absent = all of them. */
  operation: z.enum(['and', 'or']).optional(),
  keyFilters: z.array(KeyFilterSchema).min(1).max(MAX_KEY_FILTERS),
}).strict()
export type BoardFilter = z.infer<typeof BoardFilterSchema>

export const BoardFiltersSchema = z.array(BoardFilterSchema).max(MAX_BOARD_FILTERS).superRefine((filters, ctx) => {
  const keys = new Set<string>()
  const names = new Set<string>()
  filters.forEach((f, i) => {
    if (keys.has(f.key)) ctx.addIssue({ code: 'custom', message: 'Duplicate filter key', path: [i, 'key'] })
    keys.add(f.key)
    const n = f.name.toLowerCase()
    if (names.has(n)) ctx.addIssue({ code: 'custom', message: 'Duplicate filter name', path: [i, 'name'] })
    names.add(n)
  })
})

/** The editor's key suggestions (`DashboardEntityType.keys`). */
export interface EntityKeyInfo { type: KeyFilterKeyType; name: string; label: string; valueType: KeyFilterValueType; scope?: AttributeScope }

// ── references ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The board params a filter reads (a `{ $param }` value): they may not be removed while it does. */
export function filterParamKeys(filters: readonly BoardFilter[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const f of filters ?? []) for (const kf of f.keyFilters) for (const p of kf.predicates) {
    for (const v of [p.value, p.to]) if (isParamRef(v)) out.add(v.$param)
  }
  return out
}

/** The filters present in `before` and gone from `after`, by key. */
export function removedFilterKeys(before: readonly { key: string }[] | null | undefined, after: readonly { key: string }[] | null | undefined): string[] {
  const kept = new Set((after ?? []).map((f) => f.key))
  return (before ?? []).map((f) => f.key).filter((k) => !kept.has(k))
}

/** Every filter param a filter reads is one of the board's (a 422 naming the filter otherwise). */
export function assertFilterParamsKnown(filters: readonly BoardFilter[] | null | undefined, params: readonly { key: string }[] | null | undefined): void {
  const known = new Set((params ?? []).map((p) => p.key))
  for (const f of filters ?? []) {
    for (const k of filterParamKeys([f])) {
      if (!known.has(k)) throw new AppError(`${MSG.BOARD_PARAM_UNKNOWN}: '${k}' (filter '${f.key}')`, 422, ErrorCode.VALIDATION_ERROR)
    }
  }
}

// ── evaluation ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A predicate value with its `{ $param }` read from the board's current values; undefined when the param has none. */
function literal(v: FilterValue | undefined, params: Record<string, unknown>): unknown {
  if (isParamRef(v)) return Object.prototype.hasOwnProperty.call(params, v.$param) ? params[v.$param] : undefined
  return v
}

const isSet = (v: unknown): boolean => v !== null && v !== undefined && v !== ''

/** A raw value as the value type reads it; undefined when it cannot be read as one. */
export function coerce(v: unknown, type: KeyFilterValueType): string | number | boolean | undefined {
  if (!isSet(v)) return undefined
  switch (type) {
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'boolean' ? (v ? 1 : 0) : NaN
      return Number.isFinite(n) ? n : undefined
    }
    case 'boolean':
      if (typeof v === 'boolean') return v
      if (v === 'true' || v === 1 || v === '1') return true
      if (v === 'false' || v === 0 || v === '0') return false
      return undefined
    case 'datetime': {
      const t = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN
      return Number.isFinite(t) ? t : undefined
    }
    case 'string':
      return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  }
}

/** One predicate over one value. An unresolved `{ $param }` makes the predicate pass (TB: an empty user value filters nothing). */
export function predicateHolds(raw: unknown, p: KeyFilterPredicate, type: KeyFilterValueType, params: Record<string, unknown>): boolean {
  if (p.op === 'set') return isSet(raw)
  if (p.op === 'unset') return !isSet(raw)
  const v = coerce(raw, type)
  if (p.op === 'true') return v === true
  if (p.op === 'false') return v === false
  if (p.op === 'in' || p.op === 'notIn') {
    const list = (p.values ?? []).map((x) => coerce(x, type)).filter((x) => x !== undefined)
    const fold = (x: unknown) => (type === 'string' && p.ignoreCase && typeof x === 'string' ? x.toLowerCase() : x)
    const hit = v !== undefined && list.map(fold).includes(fold(v))
    return p.op === 'in' ? hit : !hit
  }
  const a = literal(p.value, params)
  if (!isSet(a)) return true
  const want = coerce(a, type)
  if (want === undefined || v === undefined) return p.op === 'ne' && v !== want
  if (type === 'string') {
    const x = p.ignoreCase ? String(v).toLowerCase() : String(v)
    const y = p.ignoreCase ? String(want).toLowerCase() : String(want)
    switch (p.op) {
      case 'eq': return x === y
      case 'ne': return x !== y
      case 'startsWith': return x.startsWith(y)
      case 'endsWith': return x.endsWith(y)
      case 'contains': return x.includes(y)
      case 'notContains': return !x.includes(y)
      default: return false
    }
  }
  if (type === 'boolean') return p.op === 'eq' ? v === want : p.op === 'ne' ? v !== want : false
  const n = v as number
  const m = want as number
  switch (p.op) {
    case 'eq': return n === m
    case 'ne': return n !== m
    case 'gt': return n > m
    case 'gte': return n >= m
    case 'lt': return n < m
    case 'lte': return n <= m
    case 'between': {
      const hi = coerce(literal(p.to, params), type)
      return hi === undefined ? n >= m : n >= m && n <= (hi as number)
    }
    default: return false
  }
}

/** One entity's values (aligned with `filter.keyFilters`) against the whole filter: key filters joined by its `operation`. */
export function filterHolds(values: readonly unknown[], filter: BoardFilter, params: Record<string, unknown>): boolean {
  const one = (kf: KeyFilter, i: number) => {
    const results = kf.predicates.map((p) => predicateHolds(values[i], p, kf.valueType, params))
    return kf.operation === 'and' ? results.every(Boolean) : results.some(Boolean)
  }
  return filter.operation === 'or' ? filter.keyFilters.some(one) : filter.keyFilters.every(one)
}

/** The key types a filter reads, for the permission asks. */
export const filterKeyTypes = (filter: BoardFilter): Set<KeyFilterKeyType> => new Set(filter.keyFilters.map((kf) => kf.key.type))
