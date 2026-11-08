import type { FieldSchema } from '@kuraykaraaslan-labs/common/server/schema-form.types'
import type { TimeWindow } from './board-window'
import type { ColumnMeta } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/source-meta'
import type { PagingSpec, ResolvedPaging, PagedEcho } from './query-paging'

/**
 * Re-exported so the rest of this module's SERVER layer can name a field
 * descriptor without each file reaching into `common/ui` itself (the import the
 * server/ui lint rule restricts). The vocabulary is common's to define; this is
 * the one place the seam crosses.
 */
export type { FieldSchema, ColumnMeta }

/**
 * The data-binding seam (phase 4b, `docs/phases/07-dashboard/03-data-binding.md`).
 *
 * A widget never names a URL — THERE IS NO URL IN THIS MODEL (owner decision
 * #5: SSRF is structurally impossible, not filtered). A widget names
 * `(sourceKey, queryKey, params)` and all three close independently:
 * `sourceKey` must resolve in the build-time contribution map, `queryKey` must
 * appear in that source's `describe()`, and `params` are validated against the
 * query's own `FieldSchema` (unknown keys rejected). An attacker who owns the
 * whole `dataBinding` jsonb can at most run a query they were already
 * authorized to run.
 */

/** How a live query's deltas fold into the last result, by shape. */
export interface LiveSpec {
  /**
   * Opaque, source-scoped topics (`<sourceKey>:<…>`) this query's deltas arrive
   * on, derived from VALIDATED params. May return none (nothing to push).
   */
  topics(ctx: DataSourceContext, params: Record<string, unknown>): Promise<string[]>
  /** `append` (series), `replace` (scalar / record), `upsert` (table rows by `upsertKey`). */
  merge: 'append' | 'replace' | 'upsert'
  /** `append` only: keep at most this many points per series. */
  maxPoints?: number
  /** `upsert` only: the row key that identifies a row. */
  upsertKey?: string
}

export const DATA_SOURCE_POINT = 'dashboard:data_source'
export const COUNTABLE_POINT = 'dashboard:countable'

export interface DataSourceContext {
  tenantId: string
  userId: string
  memberRole?: string
  locale: string
  /**
   * Resolved board parameters (scalars; a multi-select is comma-joined). Filled
   * when the query ran on a board that defines parameters; empty otherwise.
   */
  vars: Record<string, string | number | boolean>
  /**
   * The resolved time window — present only when the query declared
   * `window: 'board'` AND a window applies (the placement pinned one, or the
   * board has one). Resolved by the executor, never by the source; a source that
   * finds it undefined falls back to its own params (`days`, …).
   */
  window?: {
    from: string
    to: string
    interval: string
    aggregation: string
    timezone: string
  }
  /**
   * The validated page, sort and search (phase 18.1) — present only when the query
   * declared `paging`. The source applies it and reports `total`; it never sees an
   * unvalidated value.
   */
  paging?: ResolvedPaging
}

export interface DataSourceQueryDef {
  key: string
  label: string
  shape: 'scalar' | 'series' | 'table' | 'record'
  /** The RUNNER enforces this BEFORE execute() — a provider that forgets its own tenant guard is still unreachable to an unauthorized caller. */
  requiredPermission: string
  /** Same FieldSchema vocabulary as widget settings — one form renderer, one validator. */
  params: Record<string, FieldSchema>
  defaultTtlSeconds?: number
  /**
   * `'board'` opts this query into the board-wide time window (it receives
   * `ctx.window`, and its cache key includes the resolved window). `'none'`
   * (the default) is exactly today's behaviour: no window, byte-identical cache
   * key. Board parameters reach a query only through `{ $param }` slot values.
   */
  window?: 'board' | 'none'
  /**
   * Opt a TABLE query into server paging, sorting and search (phase 18.1): the caller may
   * send `{ page, pageSize, sort, q }`, validated against this declaration, and the source
   * answers one page plus `total`. Absent = the query answers everything in one go, as before.
   * A paged query is never live: the live-ticket route reports it `not-live` even when `live` is
   * also declared, because a delta cannot be reconciled with one sorted, searched page.
   */
  paging?: PagingSpec
  /**
   * Mark the query LIVE (docs/phases/07-dashboard/11): the board fetches it once as
   * usual, then receives deltas over the websocket gateway for exactly the
   * topics `topics()` returns. Topics are decided SERVER-SIDE from validated
   * params — the client never names one — and the live-ticket route runs the
   * same three gates before handing any out. Absent = polling only, unchanged.
   */
  live?: LiveSpec
  /**
   * Cache identity: is this result the same for every member of the tenant, or
   * per-user?
   *
   * **D2 decided (owner, 2026-09-03): the default is `'tenant'`.** The field is
   * now optional; a provider that says nothing gets tenant-wide caching.
   *
   * That default is the cheap direction and it is also the leaking one, so it
   * does not stand alone. The runner WATCHES whether `execute()` reads
   * `ctx.userId`: a query that looked at who is asking, and would have been
   * cached tenant-wide, is answered live and NOT cached — see
   * `dashboard-query.route`. So forgetting to declare `'user'` costs a cache
   * miss instead of showing one member's data to another.
   *
   * Declare `'user'` explicitly anyway when the result is per-member: the guard
   * is a floor, not a substitute for saying what you mean.
   */
  cacheScope?: 'tenant' | 'user'
  /**
   * The answer depends on `ctx.locale` (localised labels, formatted values): the cache keeps one entry
   * per locale. A query that reads `ctx.locale` WITHOUT declaring this is answered live and not cached
   * (dashboard.01), the same floor the `ctx.userId` guard gives `cacheScope`.
   */
  cacheByLocale?: boolean
  /**
   * The board parameters this query reads from `ctx.vars` (phase 35.2, selective refresh). Absent = every one (today's
   * behaviour: the cache key of a `window: 'board'` query hashes all of them). Declared, the cache key hashes only these
   * and `ctx.vars` carries only these, so a query cannot read a parameter its cache key does not distinguish (one
   * viewer's answer served to another who chose a different value). Parameters a binding passes as `{ $param }` slot
   * values reach the query through its validated params, not through this list.
   */
  readsVars?: string[]
  /**
   * What the query says about its own values (phase 23): label, unit, decimals, value map, kind, direction.
   * Keyed by what the result calls the value: `value` for a scalar, the series name, the column key of a
   * table, the field key of a record. The runner copies it into the result where the source did not state its
   * own, and the settings drawer reads it to say "from the source". The source applies its own scale before it
   * answers; a widget never multiplies.
   */
  meta?: Record<string, ColumnMeta>
  /**
   * The params that take entities (phase 36, E36-4): a binding may set one to `{ "$alias": "<key>" }`, a board alias, and
   * the runner substitutes the resolved ids (a list for `multiple`, one id otherwise) BEFORE the param's own schema
   * validates them. `entityTypes` are the `dashboard:entity_type` keys the param takes; an alias of another type is a
   * 422. A param not listed here never takes an alias.
   */
  entitySlots?: Record<string, { entityTypes: string[]; multiple: boolean }>
}

export interface ResolvedQuery {
  sourceKey: string
  queryKey: string
  /** A value may be a literal or `{ "$param": "<boardParamKey>" }` (substituted by the runner before validation). */
  params: Record<string, unknown>
  /**
   * Per-placement window override: `'board'` (the default for a query that
   * declares support) or a pinned window of this placement's own.
   */
  window?: 'board' | TimeWindow
}

export interface DataSourceResult {
  shape: 'scalar' | 'series' | 'table' | 'record'
  value?: number | string | null
  /** A scalar's meta (phase 23). */
  meta?: ColumnMeta
  series?: { name: string; points: Array<{ t: string; v: number }>; meta?: ColumnMeta }[]
  /** A column may also carry its own meta (every field of `ColumnMeta` but the label, which is `label`). */
  columns?: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'badge' } & Omit<ColumnMeta, 'label'>>
  rows?: Array<Record<string, unknown>>
  /** Paged table queries: how many rows exist in all (not just this page). The runner drops an insane value. */
  total?: number
  /** Echoed by the runner for a paged query: the page this `rows` is. */
  paging?: PagedEcho
  record?: Record<string, unknown>
  /** Per field of a record (phase 23). */
  recordMeta?: Record<string, ColumnMeta>
  fetchedAt: string
  ttlSeconds?: number
  /** Echoed by the runner when the query ran with a resolved window; `pinned` = the placement's own. */
  window?: {
    from: string; to: string; interval: string; aggregation: string; timezone: string; pinned: boolean
    mode?: 'relative' | 'absolute'; explicitTimezone?: string
    /** A calendar period under way (20.1b): live appends are kept up to here, not only up to `to`. */
    liveTo?: string
    /**
     * The kind of window chosen (the pin's, the viewer's or the board's). `mode` says how live appends are trimmed and is
     * `absolute` for every calendar period too; only an `absolute` kind is a range that never moves with the clock, so once
     * it has ended what it shows cannot change (phase 40, D40-7). "Yesterday" is another day tomorrow.
     */
    kind?: 'relative' | 'calendar' | 'absolute'
  }
  /**
   * Echoed by the runner (phase 35.2, selective refresh): the board parameters the query declared it reads from `ctx.vars`
   * (`readsVars`). Absent = it may read every one, so a card asks again on any parameter change. Never a provider's own
   * value: the runner sets or removes it.
   */
  readsVars?: string[]
}

export interface DashboardDataSource {
  readonly key: string
  describe(ctx: DataSourceContext): Promise<DataSourceQueryDef[]>
  execute(ctx: DataSourceContext, q: ResolvedQuery): Promise<DataSourceResult>
}

/**
 * One countable thing for the first-party `entity_count` source. A module
 * contributes an ARRAY of these (default export) to `dashboard:countable`;
 * each becomes a scalar query named `<moduleId>.<key>`, gated by its own
 * permission. Counts arrive by contribution, never by URL.
 */
export interface DashboardCountable {
  key: string
  /** English; the dashboard shows it in the viewer's language from `<module>.countable.<key>` of the module's dictionary (D551). */
  label: string
  /** D551: a dictionary key of the contributing module (`<module>.…`) naming this count, in place of `<module>.countable.<key>`. */
  labelKey?: string
  requiredPermission: string
  count(tenantId: string): Promise<number>
}

/** Per-slot binding stored on a placement (`dashboard_widget_instances.dataBinding`). */
export type DataBinding = Record<string, ResolvedQuery>
