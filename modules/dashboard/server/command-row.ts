import type { NextRequest } from 'next/server'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import type { PagingRequest } from './query-paging'
import type { BoardContextInput } from './query-gates'
import { rowIdColumnFor, rowIdOf, rowSlotsFor } from './row-identity'

/**
 * The row a `{ "$row": column }` command param reads (phase 35.2, E14, POSTURE §9).
 *
 * The client never sends the row. It sends the row's ID (the value of the slot's id column) and the run route
 * re-reads the row here, by re-running the placement's OWN stored binding with the viewer's board context through
 * the same authorised path as the placement query route (`POST …/instances/[id]/query`): the caller may read the
 * board and run queries at all, may see the placement's widget, and the runner applies the source's gates (the
 * module is active, the query's own permission) and validates every parameter. The row is then looked up by id in
 * what that query answered; an id the viewer's own query does not answer (forged, gone, on a page not asked for) is a
 * 404 and nothing runs. Where a source draws two slots (a 3D model's sensors and things), the client names the slot and
 * only that one is re-read. Every `{ $row }` resolves from this server-fetched row; the command's schema validates the
 * result and `execute()` authorises the resource as it always must.
 */

export interface FetchCommandRowArgs {
  request: NextRequest
  tenantId: string
  userId: string
  instance: { instanceId: string; entityId: string; widgetRef: string; pinnedVersion?: number | null; settings?: unknown; dataBinding?: unknown }
  kindType: string | undefined
  sourceKey: string
  rowId: string
  /**
   * The slot the client says the row came from, where the source draws two (a 3D model's sensors and things): only that
   * slot's query runs and only its rows are searched, so a thing never resolves to a sensor that shares its id.
   */
  rowSlot?: string
  /** The page of a server-paged table the row was on (the placement query route takes the same). */
  paging?: PagingRequest
  /** The viewer's board context (their window and parameter overrides), exactly as the placement query sends it. */
  boardContext: BoardContextInput & { boardId: string }
}

/** The not-found answer for a row: the same body as an unconfigured command, so it confirms nothing about the row. */
const rowNotFound = () => new AppError(MSG.COMMAND_NOT_CONFIGURED, 404, ErrorCode.NOT_FOUND)

/** Re-read the clicked row from the placement's own stored binding, as the viewer, by its id (see the file header). */
export async function fetchCommandRow(args: FetchCommandRowArgs): Promise<Record<string, unknown>> {
  const { request, tenantId, instance, sourceKey, rowId } = args
  // ① the placement query route's own gate: the caller may read the board and run queries at all.
  const { dashboardContext } = await import('./dashboard.route.helpers')
  const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read', alsoCheck: ['dashboard.query.execute'] })
  if (!ctx.granted.has('dashboard.query.execute')) throw new AppError(MSG.QUERY_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
  // The placement's widget, resolved for this viewer exactly as the board renders it (a widget they may not see has no rows for them).
  const { resolvePlacedWidgets } = await import('./widget-catalog.service')
  const widgets = await resolvePlacedWidgets({
    request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds, refs: [instance.widgetRef],
  })
  if (!widgets.has(instance.widgetRef)) throw rowNotFound()

  const binding = (instance.dataBinding && typeof instance.dataBinding === 'object' ? instance.dataBinding : {}) as Record<string, unknown>
  const candidates = rowSlotsFor(args.kindType, sourceKey, Object.keys(binding))
  if (candidates.length === 0) throw rowNotFound()
  // One slot is re-read, never the first that happens to hold the id: the one the client named (it must be one this source's
  // rows come from), or the source's only slot. A source of two slots with none named cannot tell which row was meant.
  let slots: string[]
  if (args.rowSlot !== undefined) {
    if (!candidates.includes(args.rowSlot)) throw rowNotFound()
    slots = [args.rowSlot]
  } else if (candidates.length === 1) {
    slots = candidates
  } else {
    throw new AppError(`${MSG.COMMAND_VALUE_REQUIRED}: 'rowSlot'`, 422, ErrorCode.VALIDATION_ERROR)
  }

  const { runQuery } = await import('./query-runner')
  const { placementPins, placementWidget } = await import('./placement-batch')
  const { placementPageSize } = await import('./placement-page-size')
  const preferredPageSize = placementPageSize(placementWidget(widgets, await placementPins(tenantId, [instance], widgets), instance), instance.settings)
  for (const slot of slots) {
    const stored = binding[slot] as { sourceKey?: unknown; queryKey?: unknown; params?: Record<string, unknown>; window?: unknown; windowOffset?: unknown } | undefined
    if (!stored || typeof stored.sourceKey !== 'string' || typeof stored.queryKey !== 'string') continue
    // ② + ③ and the parameter validation: the runner's own gates, on the stored triple, with the viewer's board context.
    const result = await runQuery({
      request, tenantId, userId: ctx.userId,
      query: {
        sourceKey: stored.sourceKey, queryKey: stored.queryKey, params: stored.params ?? {},
        window: stored.window as never, windowOffset: stored.windowOffset as never,
        ...(args.paging ? { paging: args.paging } : {}), ...(preferredPageSize ? { preferredPageSize } : {}),
      },
      boardContext: args.boardContext,
    })
    const column = rowIdColumnFor(instance.settings, slot)
    const row = (result.rows ?? []).find((r) => rowIdOf(r, column) === rowId)
    if (row) return row
  }
  throw rowNotFound()
}
