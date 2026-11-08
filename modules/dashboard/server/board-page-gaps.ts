import { allActionsOf } from './instance-actions'
import { isParamRef } from './board-window'
import { entityParamSource, isEntityParam, type BoardParam } from './board-params'

/**
 * The drill-down rule (D442): a page the board's own clicks open must never ask its viewer to "choose a value in the filters
 * above". Every `{ $param }` a card on such a page binds is either sure to hold a value when the page opens, or allowed to be
 * empty. Pure: the shipped boards' generators (SCADA device, asset and drill boards, the twins, the IoT solutions, the board
 * templates) are held to it by their tests, so a board that ships with a gap fails the build, not the demo.
 *
 *  - Sure to hold a value on a page: a parameter with a default (an entity parameter that takes its first option, or one
 *    whose set is resolved without a pick: a subtype, a list, a relation from a parameter that holds one), or a parameter
 *    EVERY `openPage` into the page sets, or holds on the page the click sits on (a frame inherits the frames below it).
 *  - Allowed to be empty: a hidden value parameter bound to an input the query does not require; the query then runs on its
 *    own default (`prepareParams`, D442). A parameter the filter bar offers (a value parameter that is not hidden, an entity
 *    the viewer picks) is the genuine prompt: the viewer can follow it, so it is not a gap.
 *
 * A page no click opens (one of the page menu) is the viewer's to fill, and the main page is the filter bar's: neither is
 * checked. `requires(sourceKey, queryKey, slot)` says whether the query requires the input; `undefined` (a query the caller
 * does not know) counts as required.
 */

export interface PageBoard {
  params: readonly BoardParam[] | readonly Record<string, unknown>[]
  pages: ReadonlyArray<{ key: string; hidden?: boolean }>
  placements: ReadonlyArray<{ pageKey?: string | null; title?: string | null; dataBinding?: unknown; actions?: unknown }>
}

export interface PageParamGap {
  page: string
  card: string
  slot: string
  sourceKey: string
  queryKey: string
  param: string
}

export type QueryRequires = (sourceKey: string, queryKey: string, slot: string) => boolean | undefined

type Binding = { sourceKey?: unknown; queryKey?: unknown; params?: Record<string, unknown> }

const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/** A parameter the filter bar offers the viewer: a value parameter that is not hidden, an entity the viewer picks. */
const choosable = (def: BoardParam): boolean => (isEntityParam(def)
  ? def.choose.type === 'viewer' && (def as { viewer?: unknown }).viewer !== 'hidden'
  : (def as { viewer?: unknown }).viewer !== 'hidden')

export function pageParamGaps(board: PageBoard, requires: QueryRequires): PageParamGap[] {
  const defs = new Map((board.params as BoardParam[]).map((p) => [p.key, p]))
  const requiredInputs = new Map(board.pages.map((p) => [p.key, new Set(((p as { inputs?: Array<{ param: string; required?: boolean }> }).inputs ?? [])
    .filter((i) => i.required).map((i) => i.param))]))
  // who opens each page: the page the click sits on and the parameters it surely sets. A literal is a value; a reference (`$row`,
  // `$param`, `$map`) may resolve to nothing (a row with no `readsKeys`: the bug D442 fixes), so it counts only for a required input
  // of the page, which the page itself waits for ("pick one") instead of querying.
  const openers = new Map<string, Array<{ from: string | null; sets: Set<string> }>>()
  for (const p of board.placements) {
    for (const a of allActionsOf(p.actions) as Array<{ kind: string; page?: unknown; set?: Record<string, unknown> }>) {
      if (a.kind !== 'openPage' || typeof a.page !== 'string') continue
      const required = requiredInputs.get(a.page) ?? new Set<string>()
      const sets = Object.entries(a.set ?? {}).filter(([k, v]) => required.has(k) || (hasValue(v) && (typeof v !== 'object' || Array.isArray(v)))).map(([k]) => k)
      const list = openers.get(a.page) ?? []
      list.push({ from: p.pageKey ?? null, sets: new Set(sets) })
      openers.set(a.page, list)
    }
  }

  // a parameter that holds a value with nothing set on the way: a default, a first option, a set resolved without a pick
  const standing = (key: string, held: ReadonlySet<string>, seen: Set<string> = new Set()): boolean => {
    if (held.has(key)) return true
    const def = defs.get(key)
    if (!def || seen.has(key)) return false
    seen.add(key)
    if (!isEntityParam(def)) return hasValue((def as { default?: unknown }).default)
    if (def.defaultFrom === 'firstOption' || hasValue((def as { default?: unknown }).default)) return true
    const source = entityParamSource(def)
    if (source) return standing(source.key, held, seen)
    // a page or viewer pick needs a value; any other set (subtype, list, all, single, name) is resolved without one
    return def.choose.type !== 'page' && def.choose.type !== 'viewer'
  }

  // the parameters sure to be set on a page: on every way in, what the click sets plus what the page it sits on holds
  const memo = new Map<string | null, Set<string> | null>()
  const heldOn = (page: string | null, visiting: Set<string | null> = new Set()): Set<string> | null => {
    if (page === null) return new Set()
    if (memo.has(page)) return memo.get(page)!
    const ways = openers.get(page)
    if (!ways?.length || visiting.has(page)) return null
    visiting.add(page)
    const each = ways.map((way) => new Set<string>([...(heldOn(way.from, visiting) ?? []), ...way.sets]))
    const out = new Set<string>([...each[0]!].filter((k) => each.every((s) => s.has(k))))
    visiting.delete(page)
    memo.set(page, out)
    return out
  }

  const gaps: PageParamGap[] = []
  for (const page of board.pages) {
    const held = heldOn(page.key)
    if (held === null) continue // no click opens it: the page menu's, the viewer fills it
    for (const p of board.placements) {
      if ((p.pageKey ?? null) !== page.key) continue
      const bindings = (p.dataBinding && typeof p.dataBinding === 'object' ? p.dataBinding : {}) as Record<string, Binding | null>
      for (const binding of Object.values(bindings)) {
        if (!binding || typeof binding.sourceKey !== 'string' || typeof binding.queryKey !== 'string') continue
        for (const [slot, value] of Object.entries(binding.params ?? {})) {
          if (!isParamRef(value) || standing(value.$param, held)) continue
          const def = defs.get(value.$param)
          // the filter bar shows it: "choose a value in the filters above" is what the viewer can do, the genuine prompt
          if (def && choosable(def)) continue
          const hiddenValue = !!def && !isEntityParam(def) && (def as { viewer?: unknown }).viewer === 'hidden'
          if (hiddenValue && requires(binding.sourceKey, binding.queryKey, slot) === false) continue
          gaps.push({ page: page.key, card: p.title ?? '', slot, sourceKey: binding.sourceKey, queryKey: binding.queryKey, param: value.$param })
        }
      }
    }
  }
  return gaps
}

/**
 * `QueryRequires` from the sources' own query definitions (`describe`): an input is required when its field says
 * `required: true`; a source or query the map does not hold is `undefined` (counted as required).
 */
export async function requiresFromSources(
  sources: Readonly<Record<string, { describe: (ctx: never) => Promise<Array<{ key: string; params: Record<string, unknown> }>> }>>,
  ctx: unknown,
): Promise<QueryRequires> {
  const defs = new Map<string, Map<string, Record<string, unknown>>>()
  for (const [key, source] of Object.entries(sources)) defs.set(key, new Map((await source.describe(ctx as never)).map((d) => [d.key, d.params])))
  return (sourceKey, queryKey, slot) => {
    const params = defs.get(sourceKey)?.get(queryKey)
    if (!params) return undefined
    return (params[slot] as { required?: unknown } | undefined)?.required === true
  }
}
