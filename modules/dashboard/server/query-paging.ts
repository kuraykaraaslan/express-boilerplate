import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'

/**
 * Server-side paging, sorting and search for a table query (phase 18.1).
 *
 * A query opts in by declaring `paging` on its definition; the runner then accepts
 * `{ page, pageSize, sort, q }` from the caller, validates every part against that
 * declaration, and hands the source a resolved `ctx.paging`. The dashboard never queries
 * a domain: the source owns the sort keys it can order by, whether it can search, and
 * how it counts; dashboard only bounds and validates what reaches it.
 *
 * Nothing here is trusted because a client sent it: the page size is capped by the query's
 * own maximum (itself capped by `HARD_MAX_PAGE_SIZE`), a sort key must be one the query
 * declared, and a search string is length-bounded. An out-of-range request is refused,
 * not clamped, so a probe for "everything" is a 400 instead of a quiet truncation.
 */
export const HARD_MAX_PAGE_SIZE = 500
export const DEFAULT_PAGE_SIZE = 25
export const MAX_SEARCH_LENGTH = 200
const MAX_PAGE = 1_000_000

/** Declared on a table query's definition. */
export interface PagingSpec {
  /** Largest page a caller may ask for; default `DEFAULT_MAX_PAGE_SIZE`, never above `HARD_MAX_PAGE_SIZE`. */
  maxPageSize?: number
  /** Page size when the caller asks for none; default `DEFAULT_PAGE_SIZE`. */
  defaultPageSize?: number
  /** Column keys the source can order by. Empty or absent = not sortable. */
  sortable?: string[]
  /** Does the source implement `q`? */
  searchable?: boolean
}
export const DEFAULT_MAX_PAGE_SIZE = 100

export const PagingRequestSchema = z
  .object({
    page: z.number().int().min(1).max(MAX_PAGE).default(1),
    pageSize: z.number().int().min(1).max(HARD_MAX_PAGE_SIZE).optional(),
    sort: z.object({ key: z.string().min(1).max(100), dir: z.enum(['asc', 'desc']) }).strict().optional(),
    q: z.string().max(MAX_SEARCH_LENGTH).optional(),
  })
  .strict()
export type PagingRequest = z.infer<typeof PagingRequestSchema>

/** What reaches the source (`ctx.paging`): all validated, `offset` precomputed. */
export interface ResolvedPaging {
  page: number
  pageSize: number
  offset: number
  sort?: { key: string; dir: 'asc' | 'desc' }
  q?: string
}

const bad = (detail: string) => new AppError(`${MSG.QUERY_PARAMS_INVALID}: ${detail}`, 400, ErrorCode.VALIDATION_ERROR)

/**
 * Validate a paging request against a query's declaration.
 *
 * - A query without `paging` takes no paging request (400) and gets `null`.
 * - A query with `paging` always gets a bounded page, even when the caller sent none.
 */
export function resolvePaging(
  def: { shape: string; paging?: PagingSpec },
  request: PagingRequest | undefined,
  /**
   * The page size the placement asks for when the request names none: the card's own "Rows per page" (`maxRows`,
   * decision 2026-10-17 #5a). Clamped to the query's maximum, never refused: it is a setting, not a caller's request.
   */
  preferredPageSize?: number,
): ResolvedPaging | null {
  const spec = def.paging
  if (!spec) {
    if (request) throw bad('this query does not page')
    return null
  }
  if (def.shape !== 'table') throw bad('only a table query can page')
  const max = Math.min(spec.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE, HARD_MAX_PAGE_SIZE)
  const fallback = Math.min(spec.defaultPageSize ?? DEFAULT_PAGE_SIZE, max)
  const page = request?.page ?? 1
  const preferred = preferredPageSize !== undefined && Number.isInteger(preferredPageSize) && preferredPageSize >= 1
    ? Math.min(preferredPageSize, max) : undefined
  const pageSize = request?.pageSize ?? preferred ?? fallback
  if (pageSize > max) throw bad(`pageSize above ${max}`)
  const out: ResolvedPaging = { page, pageSize, offset: (page - 1) * pageSize }
  if (request?.sort) {
    if (!(spec.sortable ?? []).includes(request.sort.key)) throw bad(`cannot sort by '${request.sort.key}'`)
    out.sort = request.sort
  }
  const q = request?.q?.trim()
  if (q) {
    if (!spec.searchable) throw bad('this query cannot search')
    out.q = q
  }
  return out
}

/**
 * Bound a table result to the page that was asked for. A source that ignored paging and
 * returned everything is cut to `pageSize` here, so a misbehaving provider cannot push an
 * unbounded body through the runner; `total` (what the source says exists) is kept only
 * when it is a sane count.
 */
export function boundPage<T extends { rows?: unknown[]; total?: number }>(
  result: T,
  paging: ResolvedPaging,
  spec?: PagingSpec,
): T & { paging: PagedEcho } {
  const rows = (result.rows ?? []).slice(0, paging.pageSize)
  const floor = rows.length > 0 ? paging.offset + rows.length : 0
  const total = Number.isInteger(result.total) && (result.total as number) >= floor ? result.total : undefined
  return {
    ...result,
    rows,
    total,
    // What the client may ask next: only what this query declared, so a pager never offers a sort or search the server would refuse.
    paging: {
      page: paging.page,
      pageSize: paging.pageSize,
      sortable: spec?.sortable ?? [],
      searchable: !!spec?.searchable,
      ...(paging.sort ? { sort: paging.sort } : {}),
      ...(paging.q ? { q: paging.q } : {}),
    },
  }
}

/** The page a paged result echoes (18.1), including what may be asked of it next. */
export interface PagedEcho {
  page: number
  pageSize: number
  sortable: string[]
  searchable: boolean
  sort?: { key: string; dir: 'asc' | 'desc' }
  q?: string
}
