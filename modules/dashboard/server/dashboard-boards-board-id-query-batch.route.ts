import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolvePlacedWidgets } from './widget-catalog.service'
import { dashboardContext } from './dashboard.route.helpers'
import { TimeWindowSchema, TimeZoneSchema, BoardContextParamsSchema } from './board-window'
import { PagingRequestSchema } from './query-paging'
import { resolveBoardState } from './query-gates'
import { MAX_BATCH_ITEMS, runPlacementBatch } from './placement-batch'
import MSG from './dashboard.messages'
import { AliasEntitiesSchema } from './board-aliases'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

// The item loop lives in `placement-batch.ts` (shared with the display batch, decision #10); re-exported here, where
// the UI and the tests have always imported them from.
export { MAX_BATCH_ITEMS, BATCH_CONCURRENCY, type BatchItemResult } from './placement-batch'

/**
 * Everything the client may send: the viewer's own window and parameter overrides ONCE for the board view, and per
 * item only which placement, which of its slots, which page and the window the viewer picked on that card (D40-7). Like the single-placement route there is no source,
 * query or parameter triple: every item runs what its placement has saved.
 */
const BatchQueryDTO = z
  .object({
    window: TimeWindowSchema.optional(),
    params: BoardContextParamsSchema.optional(),
    viewerTimezone: TimeZoneSchema.optional(),
    /** The viewer's current entity per single-resolve alias (phase 36, E36-6). */
    aliasEntities: AliasEntitiesSchema.optional(),
    items: z.array(z.object({
      instanceId: z.string().uuid(),
      slot: z.string().min(1).max(60).regex(/^[^#]+(#[2-8])?$/, 'Invalid slot key'),
      paging: PagingRequestSchema.optional(),
      /** The viewer's window for this card alone (phase 40, D40-7), with the board window's schema and limits; never stored. */
      window: TimeWindowSchema.optional(),
    }).strict()).min(1).max(MAX_BATCH_ITEMS),
  })
  .strict()

/**
 * POST …/dashboard/boards/[boardId]/query-batch: the data of every card of a board view in ONE request (owner
 * decision 2026-10-16, replacing a request per card and slot; a 20-card board polling every 10 s used to spend the
 * whole per-IP API budget alone).
 *
 * Gates as `…/instances/[instanceId]/query`, paid once: the rate limit, `dashboard.boards.read` plus
 * `dashboard.query.execute`, opening the board (someone else's private board is a 404), resolving every placed
 * widget for the viewer, and the board's window and parameters. Then each item runs through the same runner (the
 * source's own discoverability and permission, parameter validation, the cache). An item fails ALONE, with the status
 * and body its single route would have answered (a placement of another board, an unbound slot or a hidden widget is
 * that item's 404); the request itself fails only when the whole board view does.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.read', alsoCheck: ['dashboard.query.execute'],
    })
    if (!ctx.granted.has('dashboard.query.execute')) throw new AppError(MSG.QUERY_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
    const dto = BatchQueryDTO.parse(await request.json())

    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const placed = new Map((await DashboardInstanceService.listOnSurface(tenantId, { entityType: 'DASHBOARD', entityId: board.boardId }))
      .map((i) => [i.instanceId, i]))
    const wanted = new Set(dto.items.map((it) => placed.get(it.instanceId)?.widgetRef).filter((r): r is string => !!r))
    const widgets = wanted.size === 0 ? new Map() : await resolvePlacedWidgets({
      request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      refs: [...wanted],
    })
    const boardContext = { boardId: board.boardId, window: dto.window, params: dto.params, viewerTimezone: dto.viewerTimezone, aliasEntities: dto.aliasEntities }
    const boardState = await resolveBoardState(tenantId, ctx.userId, boardContext)

    const results = await runPlacementBatch({
      request, tenantId, userId: ctx.userId, placed, widgets, items: dto.items, boardContext, boardState,
    })
    return NextResponse.json({ results })
  } catch (e) {
    return normalizeError(e)
  }
}
