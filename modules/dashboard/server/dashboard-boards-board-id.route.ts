import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolvePinnedDefinitions, resolvePlacedWidgets, widgetLabelModules } from './widget-catalog.service'
import { requestLabelTexts } from './contributed-label-texts'
import { canEditBoard } from './board.acl'
import { UpdateBoardDTO } from './dashboard.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { boardOpenIncluded, parseBoardOpenParts } from './board-open'
import { boardAliasKeys, normalizePlacementRefs, type BoardParam } from './board-params'
import { assertBoardHeadroom } from './dashboard.entitlement'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/** What a read-only viewer keeps of a placement whose widget did not resolve for them: where the gap is. */
const UNRESOLVED_KEEP = ['instanceId', 'tenantId', 'entityType', 'entityId', 'widgetRef', 'x', 'y', 'w', 'h', 'order', 'revision'] as const

export function redactUnresolved<T extends { widgetRef: string }>(instances: T[], resolved: Map<string, unknown>): Array<T | Partial<T>> {
  return instances.map((i) => {
    if (resolved.has(i.widgetRef)) return i
    const kept: Record<string, unknown> = {}
    for (const k of UNRESOLVED_KEEP) if (k in i) kept[k] = (i as Record<string, unknown>)[k]
    return kept as Partial<T>
  })
}

/**
 * GET …/dashboard/boards/[boardId] — the board, its placements, and the resolved
 * widget for each placement.
 *
 * Returned together because the client cannot join them: resolving a `widgetRef`
 * means asking whether this caller may see that widget, which is a server
 * question. Placements whose widget did not resolve are omitted from `widgets`
 * and the renderer skips them — a revoked permission or an uninstalled module
 * leaves a gap, not a broken board. A viewer who cannot edit the board gets such a
 * placement as geometry only (`redactUnresolved`): its settings, binding and actions
 * belong to a widget they may not see. An editor keeps the full row so a save never
 * drops configuration it could not render.
 *
 * `canDuplicate`: the personal copy needs `dashboard.boards.write`, so the client offers
 * it only when the duplicate route would accept it. `canManage`: the caller holds `dashboard.boards.manage`, which display
 * links and sharing a personal board ask (phase 39, UX-1), so the client says why they are unavailable instead of hiding them.
 *
 * `pinned` (7b): for a placement that pins a published version of a resolved tenant widget, the
 * definition of that version, keyed `<widgetRef>@<version>` (`resolvePinnedDefinitions`).
 *
 * `?include=overlays,commands,embedHosts,aliasEntities` (phase 40, D40-12): a view opening the board gets, under `included`,
 * what it would otherwise ask four more routes for (`board-open.ts`), each part checked as its own route checks it and left
 * out when the caller may not read it. Read only after the board itself was (a board the caller cannot open answers nothing).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const parts = parseBoardOpenParts(request.nextUrl.searchParams.get('include'))
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.read',
      // the commands part needs the run route's permission, asked as the commands route asks it
      alsoCheck: ['dashboard.boards.write', 'dashboard.boards.manage', ...(parts.has('commands') ? ['dashboard.commands.execute'] : [])],
    })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    // A card stored before phase 41 names an entity through `{ $alias }`: answered as the `{ $param }` it now is (D41-7).
    const aliasKeys = boardAliasKeys(board)
    // The placements and their widgets resolve once; the scenes part (phase 42) reads them too, so it is the one that waits for them.
    const placed = (async () => {
      const instances = (await DashboardInstanceService.listOnSurface(tenantId, {
        entityType: 'DASHBOARD', entityId: board.boardId,
      })).map((i) => normalizePlacementRefs(i, aliasKeys).placement)
      const widgets = await resolvePlacedWidgets({
        request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
        refs: instances.map((i) => i.widgetRef),
        includeUnavailable: true, // a kind whose module is off: the board draws it inert, a create answers 422 (`dashboard:widget_kinds`)
        // D551, phase 39.16: a card's default title, its settings' and its events' words in the workspace's language
        labels: await requestLabelTexts(request, tenantId, widgetLabelModules()),
      })
      return { instances, widgets }
    })()
    // Started now, read while the placements resolve; no part ever rejects.
    const included = parts.size > 0
      ? boardOpenIncluded({
        request, tenantId, boardId: board.boardId, params: (board.params ?? []) as BoardParam[], session: ctx.session, granted: ctx.granted, parts,
        cards: async () => ({ pages: board.pages, cards: (await placed).instances, widgets: (await placed).widgets }),
      })
      : null
    const { instances, widgets } = await placed
    const canWrite = canEditBoard(board, ctx.granted)
    const pinned = await resolvePinnedDefinitions(tenantId, instances, widgets)
    return NextResponse.json({
      board: { ...board, canWrite, canDuplicate: ctx.granted.has('dashboard.boards.write'), canManage: ctx.granted.has('dashboard.boards.manage') },
      instances: canWrite ? instances : redactUnresolved(instances, widgets),
      widgets: Object.fromEntries(widgets),
      pinned,
      ...(included ? { included: await included } : {}),
    })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * PATCH …/dashboard/boards/[boardId] — rename, re-icon, or make default.
 *
 * K3: a TENANT board needs `dashboard.boards.manage`; a PRIVATE one only needs
 * to belong to the caller, which `get()` below already enforces (someone
 * else's private board reads as 404 before this ever runs).
 *
 * `scope: 'TENANT'` shares a personal board with the workspace (phase 39, UX-1): it creates a shared board as far as K3 and
 * the plan are concerned, so it needs `manage` and a free shared slot (403 with `details: { used, limit }`, counted again
 * under the board-set lock), and no card may show a widget private to its author (K10, 422 naming them).
 */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const hasManage = ctx.granted.has('dashboard.boards.manage')
    assertCanWrite(board, hasManage)
    const dto = UpdateBoardDTO.parse(await request.json())
    const sharing = dto.scope === 'TENANT' && board.scope !== 'TENANT'
    if (sharing) await assertShareable(request, tenantId, board.boardId, ctx, hasManage)
    const updated = await DashboardBoardService.update(tenantId, boardId, dto, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: sharing ? 'dashboard.board.share' : 'dashboard.board.update', resourceType: 'dashboard_board',
      resourceId: boardId, metadata: { fields: changedKeys(dto) },
    })
    return NextResponse.json({ board: updated })
  } catch (e) {
    return normalizeError(e)
  }
}

/** Whether this caller may share their personal board (UX-1): K3's `manage`, a free shared slot, no card with a private widget. */
async function assertShareable(
  request: NextRequest, tenantId: string, boardId: string, ctx: Awaited<ReturnType<typeof dashboardContext>>, hasManage: boolean,
): Promise<void> {
  assertCanWrite({ scope: 'TENANT' }, hasManage)
  await assertBoardHeadroom(tenantId, 'TENANT', ctx.userId)
  const instances = await DashboardInstanceService.listOnSurface(tenantId, { entityType: 'DASHBOARD', entityId: boardId })
  const widgets = await resolvePlacedWidgets({
    request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
    refs: instances.map((i) => i.widgetRef),
  })
  const personal = instances.filter((i) => widgets.get(i.widgetRef)?.visibility === 'PRIVATE')
  if (personal.length > 0) {
    const names = [...new Set(personal.map((i) => i.title || widgets.get(i.widgetRef)?.name || i.widgetRef))]
    throw new AppError(`${MSG.WIDGET_PRIVATE_ON_SHARED}: '${names.join("', '")}'`, 422, ErrorCode.VALIDATION_ERROR, {
      details: { placements: personal.map((i) => ({ instanceId: i.instanceId, title: i.title ?? null })) },
    })
  }
}

/** DELETE …/dashboard/boards/[boardId] — board and everything placed on it. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    assertCanWrite(board, ctx.granted.has('dashboard.boards.manage'))
    await DashboardBoardService.remove(tenantId, boardId, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.delete', resourceType: 'dashboard_board',
      resourceId: boardId, metadata: { scope: board.scope, title: board.title },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
