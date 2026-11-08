import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardInstanceService from './instance.crud.service'
import DashboardDisplayLinkService from './display-link.service'
import { resolvePlacedWidgets, type WidgetDescriptor } from './widget-catalog.service'
import { resolveDisplayContext } from './display-principal'
import { displayToken } from './display-rate-limit'
import { displayRenderable } from './display-safe'
import { TimeZoneSchema } from './board-window'
import { PagingRequestSchema } from './query-paging'
import { resolveBoardState } from './query-gates'
import { MAX_BATCH_ITEMS, runPlacementBatch, type BatchItemResult } from './placement-batch'
import { auditDisplay } from './dashboard.audit'
import MSG from './dashboard.messages'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * Everything a screen may send: the browser's zone, and per item which placement, which slot and which page in which
 * order. No window, no parameters, no search and no page size: a screen shows the board as saved, and a token holder
 * must not be able to search through a table query or pull it in bulk (the page size is the placement's own).
 */
const DisplayBatchDTO = z
  .object({
    viewerTimezone: TimeZoneSchema.optional(),
    items: z.array(z.object({
      instanceId: z.string().uuid(),
      slot: z.string().min(1).max(60).regex(/^[^#]+(#[2-8])?$/, 'Invalid slot key'),
      paging: PagingRequestSchema.pick({ page: true, sort: true }).strict().optional(),
    }).strict()).min(1).max(MAX_BATCH_ITEMS),
  })
  .strict()

type DisplayBatchItem = z.infer<typeof DisplayBatchDTO>['items'][number]

/**
 * One request per card and slot: a screen shows one page of each card, and the per-link limit counts calls, not items,
 * so a token holder must not page through a table (or defeat the cache with sort after sort) by repeating a slot in one
 * call. The first item of a slot runs; an exact repeat shares its answer (two hooks of one card may land in one batch);
 * a repeat that asks for another page or sort is that item's 400 and runs nothing.
 */
async function runOncePerSlot(items: DisplayBatchItem[], run: (items: DisplayBatchItem[]) => Promise<BatchItemResult[]>): Promise<BatchItemResult[]> {
  const first = new Map<string, { at: number; paging: string }>()
  const unique: DisplayBatchItem[] = []
  const plan = items.map((it) => {
    const key = JSON.stringify([it.instanceId, it.slot])
    const paging = JSON.stringify(it.paging ?? null)
    const seen = first.get(key)
    if (!seen) {
      first.set(key, { at: unique.length, paging })
      unique.push(it)
      return unique.length - 1
    }
    return seen.paging === paging ? seen.at : -1
  })
  const ran = await run(unique)
  const repeated = normalizeError(new AppError(MSG.DISPLAY_BATCH_SLOT_REPEATED, 400, ErrorCode.VALIDATION_ERROR))
  const error = (await repeated.json()) as Record<string, unknown>
  return plan.map((at, i) => (at >= 0
    ? { ...ran[at], instanceId: items[i].instanceId, slot: items[i].slot }
    : { instanceId: items[i].instanceId, slot: items[i].slot, ok: false, status: repeated.status, error }))
}

/**
 * POST …/dashboard/display/query-batch — the data of a display link's cards (owner decision 2026-10-17 #10). POST only
 * because it carries a list of stored placements; it reads and never writes.
 *
 * Same gates as `display/board` (per-IP limit, GUEST `dashboard.display.view`, token and per-link limit before any
 * database read, the display principal), then the session batch's runner (`runPlacementBatch`) on the link's board,
 * with three differences: every query's own permission is decided as the issuer through the display
 * (`principal.authorize`), a per-person query is refused (`forbidPersonal`), and a widget that is not display-safe (at
 * its latest version and, for a pinned card, at its pinned version too, as `display/board` decides it) is that item's
 * 404. Each card and slot is run at most once per call (`runOncePerSlot`). One `dashboard.display.read`
 * audit row per call.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.display.view', scope: 'GUEST' })
    const token = await displayToken(request, tenantId)
    const dto = DisplayBatchDTO.parse(await request.json())
    const ctx = await resolveDisplayContext(request, tenantId, token)

    const placed = new Map((await DashboardInstanceService.listOnSurface(tenantId, { entityType: 'DASHBOARD', entityId: ctx.board.boardId }))
      .map((i) => [i.instanceId, i]))
    const wanted = new Set(dto.items.map((it) => placed.get(it.instanceId)?.widgetRef).filter((r): r is string => !!r))
    const widgets = wanted.size === 0 ? new Map<string, WidgetDescriptor>() : await resolvePlacedWidgets({
      request, tenantId, session: ctx.issuer.session, userId: ctx.issuer.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      refs: [...wanted],
    })
    const boardContext = { boardId: ctx.board.boardId, viewerTimezone: dto.viewerTimezone }
    const boardState = await resolveBoardState(tenantId, ctx.issuer.userId, boardContext)

    const results = await runOncePerSlot(dto.items, (items) => runPlacementBatch({
      request, tenantId, userId: ctx.issuer.userId, placed, widgets, items, boardContext, boardState,
      principal: { authorize: ctx.authorize, forbidPersonal: true },
      isServable: displayRenderable,
    }))

    await DashboardDisplayLinkService.touch(tenantId, ctx.link.displayLinkId)
    await auditDisplay({
      tenantId, action: 'dashboard.display.read', linkId: ctx.link.displayLinkId, boardId: ctx.board.boardId,
      issuerUserId: ctx.issuer.userId, request, metadata: { items: dto.items.length },
    })
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return normalizeError(e)
  }
}
