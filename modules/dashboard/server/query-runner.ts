import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import redis, { jitter } from '@kuraykaraaslan-labs/redis'
import Logger from '@kuraykaraaslan-labs/logger'
import { buildCacheKey } from './data-source.validate'
import { appLocaleOf } from './board-template.locale'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { authorizeQuery, resolveBoardState, prepareParams, aliasResolverFor, aliasValuesFor, type BoardContextInput, type BoardState } from './query-gates'
import { resolveWindow, shiftWindowBack, effectiveWindow, windowCacheToken, toVars, varsFor, type TimeWindow, type WindowOffset } from './board-window'
import type { DataSourceContext, DataSourceResult } from './data-source.types'
import { finalizeResultMeta } from './column-meta'
import { resolvePaging, boundPage, type PagingRequest } from './query-paging'
import MSG from './dashboard.messages'

/**
 * The query runner itself (phase 4b section 3.4), shared by every route that runs a query. The
 * caller has already passed the route's own permission (gate 1) and says WHAT to run; this runs gates
 * 2 and 3 (the contribution is discoverable for the caller, then the query's own permission), validates
 * the parameters and the page, resolves the board window, and answers from the cache behind those gates
 * or from the source. Two routes sit on top of it: the free-form one (`dashboard-query.route.ts`, which
 * takes the triple from the client) and the stored-placement one (`dashboard-placements-query.route.ts`,
 * which takes it from what is saved on the placement and lets the client change nothing but the
 * board's viewer parameters).
 */
export interface RunQueryArgs {
  request: NextRequest
  tenantId: string
  userId: string
  query: {
    sourceKey: string
    queryKey: string
    params: Record<string, unknown>
    /** `'board'` follows the board window; an object pins this placement's own. */
    window?: 'board' | TimeWindow
    windowOffset?: WindowOffset
    /**
     * The viewer's window for this card alone (phase 40, D40-7: the selector on the card), never stored. It wins over the
     * card's own window and the board's, and like the board's viewer window it keeps their interval, aggregation and zone
     * where it names none. Only a query that follows a window reads it.
     */
    cardWindow?: TimeWindow
    paging?: PagingRequest
    /** The placement's own page size, used when `paging` names none (`placementPageSize`, decision 2026-10-17 #5a). */
    preferredPageSize?: number
  }
  /** The board the query runs on, with the VIEWER's overrides. */
  boardContext?: BoardContextInput
  /**
   * `boardContext` already resolved (`resolveBoardState`) by a caller that runs many queries on one board view
   * (the batch route): the board is then read once per request, not once per query. Must come from the same context.
   */
  boardState?: BoardState
  /**
   * Set when the caller is a display link, not a session (decision #10, `display-principal.ts`). Gate ③ is then
   * decided by `authorize` (as the link's issuer), and nothing personal may run: a query declared `cacheScope: 'user'`
   * is refused before the cache and before `execute()`, and an `execute()` that reads `ctx.userId` is refused while
   * it runs, so its answer is never returned nor cached. A shared screen shows what the tenant shows, never what the
   * issuer alone would see.
   */
  principal?: { authorize(permission: string): Promise<void>; forbidPersonal: true }
  /**
   * The app language (`appLocaleOf`) already resolved by a caller that runs many queries for one request (the batch). Absent, the runner
   * resolves it: the person's app language, else the workspace's default, never the browser's Accept-Language (run 3 #3).
   */
  locale?: string
}

export async function runQuery(args: RunQueryArgs): Promise<DataSourceResult> {
  const { tenantId, userId, query: q } = args
  // Board context: defaults under the viewer's overrides, parameters validated.
  const boardState = args.boardState ?? await resolveBoardState(tenantId, userId, args.boardContext)
  const { boardWindow, paramValues, viewerTimezone } = boardState

  // `userId` is a WATCHED getter, not a plain field. D2's default is
  // `'tenant'` (owner, 2026-09-03), which is the cheap direction and also the
  // leaking one: a provider that forgets to declare `'user'` would have its
  // per-member answer cached under a tenant-wide key and served to the next
  // member who asked.
  //
  // Observing the read is precise where a source scan is not — it catches a
  // marketplace provider this repo has never seen, and it costs one boolean.
  let readUserId = false
  // The locale is watched the same way (dashboard.01): an answer that depends on it must not be
  // cached under a key that does not.
  let readLocale = false
  // Display principal only: true while `execute()` runs, when reading who is asking is refused.
  let executing = false
  const personal = () => new AppError(MSG.DISPLAY_QUERY_PERSONAL, 403, ErrorCode.FORBIDDEN)
  const locale = args.locale ?? await appLocaleOf(args.request, tenantId)
  const ctx: DataSourceContext = {
    tenantId,
    get userId() {
      if (executing && args.principal?.forbidPersonal) throw personal()
      readUserId = true
      return userId
    },
    get locale() { readLocale = true; return locale },
    vars: toVars(paramValues),
  }

  // ② + ③ — shared with the live-ticket route (`query-gates.ts`).
  const { source, def } = await authorizeQuery({
    request: args.request, tenantId, sourceKey: q.sourceKey, queryKey: q.queryKey, ctx,
    authorize: args.principal?.authorize,
  })
  if (args.principal?.forbidPersonal && (def.cacheScope ?? 'tenant') === 'user') throw personal()
  // Selective refresh (35.2): a query that declares the vars it reads sees only those, and its cache key hashes only those.
  ctx.vars = varsFor(ctx.vars ?? {}, def.readsVars)

  // Entity parameters (phases 36, 41): resolved for the viewer, behind each entity type's own permission, asked the way gate ③
  // asks (a display link as its issuer). Resolved once per board state, so a batch resolves each parameter once.
  const aliasValues = await aliasValuesFor(def, q.params, boardState, () => aliasResolverFor(boardState, {
    tenantId, locale,
    authorize: args.principal?.authorize
      ?? (async (permission) => { await authorizeRequest({ request: args.request, tenantId, requiredPermission: permission, scope: 'TENANT' }) }),
  }))
  const cleanParams = prepareParams(def, q.params, boardState, !!args.boardContext, aliasValues)
  const query = { sourceKey: q.sourceKey, queryKey: q.queryKey, params: cleanParams }
  const paging = resolvePaging(def, q.paging, q.preferredPageSize)
  if (paging) ctx.paging = paging

  // A query that did not opt in (`window: 'board'`) gets no window and keeps
  // today's cache key exactly.
  let resolved: ReturnType<typeof resolveWindow> | null = null
  let pinned = false
  // The zone someone CHOSE (viewer, board or placement window), not the UTC default the resolver falls back to,
  // so a chart can draw its axis in it without changing every board that never picked one.
  let explicitTimezone: string | undefined
  // Relative windows slide with "now"; an absolute one is history. The client trims live appends by it (20.1d).
  let windowMode: 'relative' | 'absolute' | undefined
  // The window as chosen: only an absolute one never moves with the clock (phase 40, D40-7); a calendar period rolls over.
  let windowKind: TimeWindow['mode'] | undefined
  if (def.window === 'board') {
    const own = q.window && q.window !== 'board' ? q.window : null
    // The card's window, whoever chose it (the author's pin or the viewer's choice on the card), is not the board's.
    pinned = !!own || !!q.cardWindow
    const chosen = q.cardWindow
      ? effectiveWindow({ viewer: q.cardWindow, board: own ?? boardWindow })
      : effectiveWindow({ pinned: own, board: boardWindow })
    if (chosen) {
      resolved = resolveWindow(chosen, new Date(), { timezone: viewerTimezone })
      // The period before is history whatever the window it follows: fixed bounds, never slid (24.2b).
      if (q.windowOffset === 'previous') resolved = shiftWindowBack(resolved)
      explicitTimezone = chosen.timezone
      // A calendar period is history with fixed bounds (20.1b): live appends are trimmed to it, never slid.
      windowMode = chosen.mode === 'relative' && q.windowOffset !== 'previous' ? 'relative' : 'absolute'
      windowKind = chosen.mode
    }
  }
  if (resolved) {
    ctx.window = {
      from: resolved.from, to: resolved.to, interval: resolved.interval,
      aggregation: resolved.aggregation, timezone: resolved.timezone,
    }
  }

  // What the answer says about its window. Recomputed for every request, a cache hit included: two views that read the
  // same rows (a current period with and without "so far", a pinned and a following card) share the cached rows, never
  // each other's echo (review 2026-10-17).
  const echo: DataSourceResult['window'] | undefined = ctx.window ? {
    ...ctx.window, pinned,
    ...(windowMode ? { mode: windowMode } : {}),
    ...(windowKind ? { kind: windowKind } : {}),
    ...(explicitTimezone ? { explicitTimezone } : {}),
    // A current calendar period (20.1b): live appends run to the period's end; `to` stays where the read ended.
    ...(resolved?.periodEnd ? { liveTo: resolved.periodEnd } : {}),
  } : undefined

  const cacheKey = buildCacheKey(
    tenantId, query, def, userId,
    def.window === 'board'
      ? { windowToken: resolved ? (windowCacheToken(resolved) ?? null) : undefined, vars: ctx.vars }
      : undefined,
    paging,
    locale,
  )
  if (cacheKey) {
    const hit = await redis.get(cacheKey).catch(() => null)
    if (hit) {
      // Parseable is not enough: a hit of the wrong shape (another writer under `dash:q:`, a deploy that
      // changed the result shape) is a miss, never an answer (dashboard.17).
      try {
        const cached: unknown = JSON.parse(hit)
        if (isCachedResult(cached)) {
          // An entry written before the query declared meta (a deploy inside the TTL) still gets it.
          const full = finalizeResultMeta(cached, def.meta)
          return withReadsVars(echo ? { ...full, window: echo } : full, def.readsVars)
        }
      } catch { /* fall through to live */ }
    }
  }

  // Only the EXECUTE read matters: `describe()` above legitimately looks at
  // who is asking to decide which queries to offer, and that answer is not
  // what gets cached.
  readUserId = false
  readLocale = false
  executing = true
  let executed: DataSourceResult
  try {
    executed = await source.execute(ctx, query)
  } finally {
    executing = false
  }
  const bounded = paging ? boundPage(executed, paging, def.paging) : executed
  // Phase 23: what the query says about its values, cleaned once here; the cache holds the cleaned form.
  const result = finalizeResultMeta(bounded, def.meta)
  if (echo) result.window = echo

  // The guard. A query that looked at who is asking, under tenant scope, is
  // answered LIVE and never written to the cache — the failure is a cache
  // miss rather than one member's data shown to another, and the log names
  // the query so the provider can declare `'user'` and get its cache back.
  const perUserUnderTenantScope = readUserId && (def.cacheScope ?? 'tenant') !== 'user'
  if (perUserUnderTenantScope) {
    Logger.warn(
      `[dashboard] '${q.sourceKey}.${q.queryKey}' read ctx.userId under tenant cacheScope`
      + ' — answered live and NOT cached. Declare cacheScope: \'user\' to make it cacheable.',
    )
  }

  const localisedWithoutKey = readLocale && !def.cacheByLocale
  if (localisedWithoutKey) {
    Logger.warn(
      `[dashboard] '${q.sourceKey}.${q.queryKey}' read ctx.locale without cacheByLocale`
      + ' — answered live and NOT cached. Declare cacheByLocale: true to make it cacheable.',
    )
  }

  const ttl = result.ttlSeconds ?? def.defaultTtlSeconds ?? 0
  if (cacheKey && ttl > 0 && !perUserUnderTenantScope && !localisedWithoutKey) {
    await redis.setex(cacheKey, jitter(ttl), JSON.stringify(result)).catch((err) =>
      Logger.warn(`[dashboard] query cache write failed: ${err}`))
  }
  return withReadsVars(result, def.readsVars)
}

/**
 * The answer with the parameters its query declared it reads (`readsVars`, 35.2) echoed, so the client's selective refresh
 * narrows only for a query that declared them (`useWidgetData`); without a declaration the echo is removed, whatever the
 * provider put there.
 */
export function withReadsVars(result: DataSourceResult, readsVars: readonly string[] | undefined): DataSourceResult {
  const { readsVars: _provider, ...rest } = result
  return Array.isArray(readsVars) ? { ...rest, readsVars: readsVars.filter((k): k is string => typeof k === 'string') } : rest
}

/**
 * A cache hit's envelope check: a known `shape`, a `fetchedAt` string, and the payload that shape
 * reads. Structural only (the widget renderers already tolerate odd values inside the payload);
 * it exists so a corrupt-yet-parseable entry is treated as a miss.
 */
export function isCachedResult(v: unknown): v is DataSourceResult {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  if (typeof r.fetchedAt !== 'string') return false
  switch (r.shape) {
    case 'scalar': return r.value === undefined || r.value === null || typeof r.value === 'number' || typeof r.value === 'string'
    case 'series': return Array.isArray(r.series)
    case 'table': return Array.isArray(r.rows)
    case 'record': return !!r.record && typeof r.record === 'object' && !Array.isArray(r.record)
    default: return false
  }
}
