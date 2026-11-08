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
import { placementPageSize } from './placement-page-size'
import { runQuery } from './query-runner'
import { placementPins, placementWidget } from './placement-batch'
import MSG from './dashboard.messages'
import { AliasEntitiesSchema } from './board-aliases'

type Ctx = { params: Promise<{ tenantId: string; boardId: string; instanceId: string }> }

/**
 * What the client may send here, and all of it: which of the placement's slots to run, the viewer's own
 * board window and parameter overrides, and the page of a paged table. There is NO source, query or
 * parameter triple, so the client cannot point this route at anything the placement does not already say.
 */
const PlacementQueryDTO = z
  .object({
    slot: z.string().min(1).max(60).regex(/^[^#]+(#[2-8])?$/, 'Invalid slot key'),
    window: TimeWindowSchema.optional(),
    params: BoardContextParamsSchema.optional(),
    viewerTimezone: TimeZoneSchema.optional(),
    /** The viewer's current entity per single-resolve alias (phase 36, E36-6). */
    aliasEntities: AliasEntitiesSchema.optional(),
    paging: PagingRequestSchema.optional(),
    /** The viewer's window for this card alone (phase 40, D40-7), as a batch item carries it; never stored. */
    cardWindow: TimeWindowSchema.optional(),
  })
  .strict()

/**
 * POST …/dashboard/boards/[boardId]/instances/[instanceId]/query: run one slot of a STORED placement
 * (finding 16 of the deep Legacy comparison, the prerequisite of a display link).
 *
 * The free-form runner (`POST …/dashboard/query`) takes `(source, query, params)` from the client and
 * authorises that triple; this one takes it from the placement's saved `dataBinding`. The caller must
 * be able to open the board (someone else's private board is a 404) and to read the board, may run
 * queries at all, and may see the placement's widget (resolved exactly as when the board renders); then
 * the same runner applies the same gates (source discoverable, the query's own permission), parameter
 * validation and cache. A slot the placement does not bind is a 404, not a way to run something else.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId, instanceId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.read', alsoCheck: ['dashboard.query.execute'],
    })
    if (!ctx.granted.has('dashboard.query.execute')) throw new AppError(MSG.QUERY_NOT_PERMITTED, 403, ErrorCode.FORBIDDEN)
    const dto = PlacementQueryDTO.parse(await request.json())

    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const instance = await DashboardInstanceService.get(tenantId, instanceId)
    // A placement of another board is not this board's, whatever its id.
    if (instance.entityType !== 'DASHBOARD' || instance.entityId !== board.boardId) {
      throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    }
    const widgets = await resolvePlacedWidgets({
      request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      refs: [instance.widgetRef],
    })
    if (!widgets.has(instance.widgetRef)) throw new AppError(MSG.WIDGET_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

    const stored = ((instance.dataBinding ?? {}) as Record<string, unknown>)[dto.slot] as
      | { sourceKey: string; queryKey: string; params?: Record<string, unknown>; window?: 'board' | z.infer<typeof TimeWindowSchema>; windowOffset?: 'previous' }
      | undefined
    if (!stored || typeof stored.sourceKey !== 'string' || typeof stored.queryKey !== 'string') {
      throw new AppError(MSG.BINDING_SLOT_UNKNOWN, 404, ErrorCode.NOT_FOUND)
    }

    return NextResponse.json(await runQuery({
      request, tenantId, userId: ctx.userId,
      query: {
        sourceKey: stored.sourceKey, queryKey: stored.queryKey, params: stored.params ?? {}, window: stored.window, windowOffset: stored.windowOffset, paging: dto.paging,
        ...(dto.cardWindow ? { cardWindow: dto.cardWindow } : {}),
        // 7b: a pinned card pages as its pinned version (its preset's Rows per page), as the batch does.
        preferredPageSize: placementPageSize(placementWidget(widgets, await placementPins(tenantId, [instance], widgets), instance), instance.settings),
      },
      boardContext: { boardId: board.boardId, window: dto.window, params: dto.params, viewerTimezone: dto.viewerTimezone, aliasEntities: dto.aliasEntities },
    }))
  } catch (e) {
    return normalizeError(e)
  }
}
