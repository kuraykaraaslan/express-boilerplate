import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { allActionsOf } from './instance-actions'
import { BoardParamKeySchema } from './board-window'

/**
 * In-board pages (D-1 option (a), owner decision 2026-10-16), next to the board-as-state option (b) that
 * `openBoard` and the trail already give.
 *
 * A board keeps an ordered list of extra pages in `dashboard_boards.pages`; a placement names the page it sits on in
 * `pageKey`, and `null` is the board's main page (every board has one, and every placement made before pages existed
 * is on it). Widget config stays fused with its placement (D-2: the K7/K8 model is kept; a card is on exactly one
 * page). The window is the board's, shared by every page.
 *
 * Phase 29 (docs/phases/07-dashboard/29): a page is also a contract. `inputs` names the board params it works on
 * (a Device page needs `device`); `hidden` keeps a detail page out of the page menu (an action opens it); `opensAs`
 * is how an action opens it by default (as a page, a side panel, a dialog or a popover); `start` makes it the page a
 * plain link opens. The param definitions stay on the board, so the server checks values exactly as before.
 *
 * Pure: the services and the DTOs share these rules, and the tests need no database.
 */

/** At most this many extra pages per board (the main page is not counted). */
export const MAX_BOARD_PAGES = 20
/** At most this many inputs per page. */
export const MAX_PAGE_INPUTS = 8

/** How a page is shown when an action opens it (phase 29): in place of the cards, or over them. */
export const PAGE_DISPLAYS = ['page', 'panel', 'dialog', 'popover'] as const
export type PageDisplay = (typeof PAGE_DISPLAYS)[number]
/** The width of a side panel, dialog or popover. */
export const PAGE_SIZES = ['sm', 'md', 'lg'] as const
export type PageSize = (typeof PAGE_SIZES)[number]

export const BoardPageKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/, 'Invalid page key')

export const PageInputSchema = z
  .object({
    /** A board param key. */
    param: BoardParamKeySchema,
    /** The page shows a "pick one" state instead of querying while this has no value. */
    required: z.boolean().optional(),
  })
  .strict()
export type PageInput = z.infer<typeof PageInputSchema>

export const BoardPageSchema = z
  .object({
    key: BoardPageKeySchema,
    title: z.string().trim().min(1).max(80),
    icon: z.string().max(64).optional(),
    /** A detail page: not in the page menu, opened by an action (and listed while it is open). */
    hidden: z.boolean().optional(),
    /** The board params this page works on. */
    inputs: z.array(PageInputSchema).max(MAX_PAGE_INPUTS).optional(),
    /** How an action opens it unless the action says otherwise; absent = as a page. */
    opensAs: z.enum(PAGE_DISPLAYS).optional(),
    /** Panel / dialog / popover width; absent = medium. */
    size: z.enum(PAGE_SIZES).optional(),
    /** The page a plain link opens (at most one per board; none = the main page). */
    start: z.boolean().optional(),
  })
  .strict()
export type BoardPage = z.infer<typeof BoardPageSchema>

export const BoardPagesSchema = z
  .array(BoardPageSchema)
  .max(MAX_BOARD_PAGES)
  .superRefine((pages, ctx) => {
    const seen = new Set<string>()
    let starts = 0
    pages.forEach((p, i) => {
      if (seen.has(p.key)) ctx.addIssue({ code: 'custom', message: `Duplicate page key '${p.key}'`, path: [i, 'key'] })
      seen.add(p.key)
      if (p.start) starts += 1
      if (p.start && p.hidden) ctx.addIssue({ code: 'custom', message: `The start page '${p.key}' cannot be hidden`, path: [i, 'start'] })
      const params = new Set<string>()
      ;(p.inputs ?? []).forEach((input, j) => {
        if (params.has(input.param)) ctx.addIssue({ code: 'custom', message: `Duplicate input '${input.param}'`, path: [i, 'inputs', j, 'param'] })
        params.add(input.param)
      })
    })
    if (starts > 1) ctx.addIssue({ code: 'custom', message: 'At most one start page', path: [] })
  })

/** The main page's own name and icon (it has no entry in `pages`); `null` on the board = "Main" and no icon. */
export const MainPageSchema = z
  .object({
    title: z.string().trim().min(1).max(80).optional(),
    icon: z.string().max(64).optional(),
  })
  .strict()
export type MainPage = z.infer<typeof MainPageSchema>

/** The pages that take one of `keys` as an input, by key and title: what a refused parameter removal names (409). */
export function pagesTakingParams(pages: unknown, keys: readonly string[]): Array<{ key: string; title: string }> {
  if (!Array.isArray(pages) || keys.length === 0) return []
  return (pages as Array<{ key?: unknown; title?: unknown; inputs?: Array<{ param?: unknown }> }>)
    .filter((p) => (p?.inputs ?? []).some((input) => typeof input?.param === 'string' && keys.includes(input.param)))
    .map((p) => ({ key: String(p.key ?? ''), title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : String(p.key ?? '') }))
}

/** The board params some page takes as an input: a board param a page still names cannot be removed. */
export function pageInputParamKeys(pages: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(pages)) return out
  for (const p of pages as Array<{ inputs?: Array<{ param?: unknown }> }>) {
    for (const input of p?.inputs ?? []) if (typeof input?.param === 'string') out.add(input.param)
  }
  return out
}

/** 422 when a page names an input the board has no param for. */
export function assertPageInputsKnown(pages: unknown, params: unknown): void {
  const known = new Set(Array.isArray(params) ? (params as Array<{ key?: unknown }>).map((d) => d?.key).filter((k): k is string => typeof k === 'string') : [])
  const unknown = [...pageInputParamKeys(pages)].filter((k) => !known.has(k))
  if (unknown.length > 0) {
    // The existing message (already in every language): the param a page names as its input is not on the board.
    throw new AppError(`${MSG.BOARD_PARAM_UNKNOWN}: '${unknown.join("', '")}'`, 422, ErrorCode.VALIDATION_ERROR)
  }
}

/**
 * The required inputs of the page an `openPage` action opens that nothing fills: not set by the action, not an input
 * of the page the action sits on (the opener holds that value), and without a board default. Empty = the action is
 * complete. Opening the main page (`null`) needs nothing.
 */
export function missingPageInputs(
  action: { page?: string | null; set?: Record<string, unknown> },
  pages: unknown,
  params: unknown,
  openerPageKey: string | null | undefined,
): string[] {
  if (!Array.isArray(pages) || typeof action.page !== 'string') return []
  const list = pages as BoardPage[]
  const target = list.find((p) => p.key === action.page)
  if (!target) return []
  const opener = openerPageKey ? list.find((p) => p.key === openerPageKey) : undefined
  const held = new Set((opener?.inputs ?? []).map((i) => i.param))
  const defaults = new Set(
    (Array.isArray(params) ? (params as Array<{ key: string; default?: unknown }>) : [])
      .filter((d) => d.default !== undefined && d.default !== null && d.default !== '')
      .map((d) => d.key),
  )
  return (target.inputs ?? [])
    .filter((i) => i.required && !(i.param in (action.set ?? {})) && !held.has(i.param) && !defaults.has(i.param))
    .map((i) => i.param)
}

/**
 * The placements whose `openPage` actions would leave a required input of their target page without a value under
 * these pages and params (phase 35, E9: the stored actions are re-checked when the board's pages or parameters
 * change, the way a placement write checks them). Each named with what it would leave unset.
 */
export function placementsNeedingInputs(
  placements: Array<{ instanceId: string; title?: string | null; pageKey?: string | null; actions?: unknown }>,
  pages: unknown,
  params: unknown,
): Array<{ instanceId: string; title: string | null; missing: string[] }> {
  const out: Array<{ instanceId: string; title: string | null; missing: string[] }> = []
  for (const p of placements) {
    const missing = new Set<string>()
    for (const a of allActionsOf(p.actions) as Array<{ kind: string; page?: string | null; set?: Record<string, unknown> }>) {
      if (a.kind !== 'openPage') continue
      for (const k of missingPageInputs(a, pages, params, p.pageKey ?? null)) missing.add(k)
    }
    if (missing.size > 0) out.push({ instanceId: p.instanceId, title: p.title ?? null, missing: [...missing] })
  }
  return out
}

/**
 * The placements whose missing inputs THIS change adds to (phase 35 review, F3): `placementsNeedingInputs` before and
 * after, keeping only the inputs a card did not already lack. A card short of an input before the change (a row from
 * before the check existed, a card moved off the page that held the value) is not this save's doing, so it must not
 * block an unrelated one (a new parameter, a renamed page), or the board could never be edited again; only a save that
 * marks an input required or takes a default away is refused, and only for the inputs it takes away.
 */
export function placementsNewlyNeedingInputs(
  placements: Array<{ instanceId: string; title?: string | null; pageKey?: string | null; actions?: unknown }>,
  before: { pages: unknown; params: unknown },
  after: { pages: unknown; params: unknown },
): Array<{ instanceId: string; title: string | null; missing: string[] }> {
  const was = new Map(placementsNeedingInputs(placements, before.pages, before.params).map((p) => [p.instanceId, new Set(p.missing)]))
  const out: Array<{ instanceId: string; title: string | null; missing: string[] }> = []
  for (const p of placementsNeedingInputs(placements, after.pages, after.params)) {
    const missing = p.missing.filter((k) => !was.get(p.instanceId)?.has(k))
    if (missing.length > 0) out.push({ ...p, missing })
  }
  return out
}

/** 422 when a placement's `openPage` action leaves a required input of its target page without a value. */
export function assertActionPageInputs(actions: unknown, pages: unknown, params: unknown, openerPageKey: string | null | undefined): void {
  for (const a of allActionsOf(actions) as Array<{ kind: string; page?: string | null; set?: Record<string, unknown> }>) {
    if (a.kind !== 'openPage') continue
    const missing = missingPageInputs(a, pages, params, openerPageKey)
    if (missing.length > 0) {
      // The existing message (already in every language), names only: the page would open with these params unset.
      throw new AppError(`${MSG.BOARD_PARAM_UNRESOLVED}: '${missing.join("', '")}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
  }
}

/** The page keys a board defines (the main page, `null`, is implicit). */
export function pageKeysOf(pages: unknown): Set<string> {
  if (!Array.isArray(pages)) return new Set()
  return new Set(pages.map((p) => (p && typeof p === 'object' ? (p as { key?: unknown }).key : undefined)).filter((k): k is string => typeof k === 'string'))
}

/** Keys present before and absent after an edit of the page list. */
export function removedPageKeys(before: unknown, after: BoardPage[] | null): string[] {
  const kept = pageKeysOf(after)
  return [...pageKeysOf(before)].filter((k) => !kept.has(k))
}

/** 422 when a placement names a page its board does not have; `null` / absent (the main page) always passes. */
export function assertPageOnBoard(pageKey: string | null | undefined, pages: unknown): void {
  if (pageKey == null) return
  if (!pageKeysOf(pages).has(pageKey)) {
    throw new AppError(`${MSG.BOARD_PAGE_UNKNOWN}: '${pageKey}'`, 422, ErrorCode.VALIDATION_ERROR)
  }
}

/** The pages the `openPage` actions of these placements open (`null`, the main page, is never listed). */
export function referencedActionPageKeys(actionSets: unknown[]): Set<string> {
  const out = new Set<string>()
  for (const raw of actionSets) {
    for (const a of allActionsOf(raw) as Array<{ kind: string; page?: unknown }>) {
      if (a.kind === 'openPage' && typeof a.page === 'string') out.add(a.page)
    }
  }
  return out
}

/** 422 when a placement's `openPage` action opens a page its board does not have. */
export function assertActionPagesOnBoard(actions: unknown, pages: unknown): void {
  for (const key of referencedActionPageKeys([actions])) assertPageOnBoard(key, pages)
}

