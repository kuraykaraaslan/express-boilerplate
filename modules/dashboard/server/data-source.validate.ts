import { createHash } from 'node:crypto'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { zodFromSchema } from '@kuraykaraaslan-labs/common/server/schema-form.zod'
import MSG from './dashboard.messages'
import type { DataSourceQueryDef } from './data-source.types'
import type { ResolvedPaging } from './query-paging'
import { varsFor } from './board-window'

/**
 * Validate params against the query's FieldSchema. `zodFromSchema` STRIPS
 * unknown keys (right for stored settings); a QUERY must reject them instead —
 * an unknown parameter is either a typo or a probe, and silently dropping it
 * turns both into a confusing wrong answer.
 */
export function validateParams(def: DataSourceQueryDef, params: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set(Object.keys(def.params))
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) throw new AppError(`${MSG.QUERY_PARAMS_INVALID}: '${key}'`, 400, ErrorCode.VALIDATION_ERROR)
  }
  const parsed = zodFromSchema(def.params).safeParse(params)
  if (!parsed.success) {
    const key = parsed.error.issues.map((i) => i.path[0]).find((k): k is string => typeof k === 'string' && allowed.has(k))
    throw new AppError(MSG.QUERY_PARAMS_INVALID, 400, ErrorCode.VALIDATION_ERROR, key ? { details: paramDetails(def, key, 'invalid') } : undefined)
  }
  const missing = missingRequired(def.params, parsed.data)
  if (missing) throw new AppError(`${MSG.QUERY_PARAMS_INVALID}: '${missing}'`, 400, ErrorCode.VALIDATION_ERROR, { details: paramDetails(def, missing, 'missing') })
  return parsed.data
}

/**
 * Which parameter of the query a refusal is about, and its label (e2e run 1, V3-B16): the card words it ("This card is not finished: choose its
 * Device") instead of printing "Could not load data (400)". Only the query's own declared keys are named, never a value the caller sent.
 */
function paramDetails(def: DataSourceQueryDef, key: string, reason: 'missing' | 'invalid'): { param: string; label: string; reason: 'missing' | 'invalid' } {
  const label = (def.params[key] as { label?: unknown } | undefined)?.label
  return { param: key, label: typeof label === 'string' && label ? label : key, reason }
}

/**
 * The first field marked `required: true` that has no value, or null. `zodFromSchema` makes every
 * field optional (right for stored settings, where a template default fills the gap), so a query's
 * or a command's `required` is enforced here (dashboard.09). Absent, null, '' and [] are all "no value".
 */
export function missingRequired(schema: Record<string, { required?: boolean }>, values: Record<string, unknown>): string | null {
  for (const [key, field] of Object.entries(schema)) {
    if (!field?.required) continue
    const v = values[key]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return key
  }
  return null
}

/**
 * Cache identity for one execution.
 *
 * `cacheScope` defaults to `'tenant'` (D2, owner decision 2026-09-03);
 * `'user'` results are keyed per user so one member's data can never answer
 * another's request. A query with no declared TTL is live-only: no key, no
 * cache.
 *
 * The default is the leaking direction, which is why the runner also watches
 * for an `execute()` that read `ctx.userId` under tenant scope and declines to
 * cache that result at all.
 */
export function buildCacheKey(
  tenantId: string,
  query: { sourceKey: string; queryKey: string; params: Record<string, unknown> },
  def: DataSourceQueryDef,
  userId: string,
  /**
   * Board context for a query that declared `window: 'board'` — the resolved
   * window token and the board parameter values. Omitted for every other query,
   * which keeps its cache key byte-identical to what it was before boards had a
   * window. A window that is not cacheable (an absolute range still being
   * written to) passes `windowToken: null` and the query is answered live.
   */
  boardContext?: { windowToken: string | null | undefined; vars?: Record<string, string | number | boolean> },
  /** The resolved page of a paged query (18.1): each page, sort and search is its own entry. Omitted otherwise, which keeps every other key byte-identical. */
  paging?: ResolvedPaging | null,
  /** The viewer's (sanitised) locale; folded into the key only for a `cacheByLocale` query. */
  locale?: string,
): string | null {
  if (!def.defaultTtlSeconds) return null
  if (boardContext && boardContext.windowToken === null) return null
  const g = paging ? { g: { n: paging.page, s: paging.pageSize, o: paging.sort ?? null, q: paging.q ?? null } } : {}
  // `readsVars` (35.2): only the board parameters the query declares it reads tell two answers apart; absent, all of them.
  const hashInput = boardContext
    ? JSON.stringify({ p: query.params, w: boardContext.windowToken ?? null, v: varsFor(boardContext.vars ?? {}, def.readsVars), ...g })
    : paging
      ? JSON.stringify({ p: query.params, ...g })
      : JSON.stringify(query.params)
  const paramsHash = createHash('sha256').update(hashInput).digest('hex')
  const base = `dash:q:${tenantId}:${query.sourceKey}:${query.queryKey}:${paramsHash}`
  const localised = def.cacheByLocale ? `${base}:l=${locale ?? 'en'}` : base
  return (def.cacheScope ?? 'tenant') === 'user' ? `${localised}:${userId}` : localised
}

/** A BCP 47-shaped tag from the first `Accept-Language` entry, or `en`. It ends up inside a Redis key. */
export function requestLocale(header: string | null | undefined): string {
  const first = header?.split(',')[0]?.split(';')[0]?.trim() ?? ''
  return /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8}){0,4}$/.test(first) ? first : 'en'
}
