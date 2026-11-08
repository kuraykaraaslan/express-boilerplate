import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolvePlacedWidgets } from './widget-catalog.service'
import { assertBoardHeadroom } from './dashboard.entitlement'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { commandVerdictsFor, stripUnauthorisedCommands } from './command-verdicts'
import { elementAuthoringFor } from './element-authoring'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

const DuplicateBoardDTO = z
  .object({
    title: z.string().min(1).max(120).optional(),
    scope: z.enum(['TENANT', 'PRIVATE']).optional(),
  })
  .strict()

/**
 * POST …/dashboard/boards/[boardId]/duplicate — copy a board's cards onto a new one.
 *
 * "Start from an existing board" (Faz 9, dilim 9.1) and the personal-copy half
 * of K4 both go through this: default `scope` is `PRIVATE` and defaults to the
 * SAME anchor as the source, which is exactly what "customise without
 * `manage`" needs — the route that path calls through is
 * `dashboard-workspaces-workspace-board.route.ts`'s POST, not this one, but
 * both end at `DashboardBoardService.duplicate`.
 *
 * `scope: 'TENANT'` needs `dashboard.boards.manage` — copying is still
 * creating a shared board, and K3 does not have a shortcut for it.
 *
 * A copied `command` action passes the same authoring gate as a placement the caller
 * creates by hand: entries for a command they could not run themselves are dropped and
 * counted in `droppedCommands` (the run route re-checks per press either way).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const hasManage = ctx.granted.has('dashboard.boards.manage')
    const source = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const dto = DuplicateBoardDTO.parse(await request.json().catch(() => ({})))
    const scope = dto.scope ?? 'PRIVATE'
    assertCanWrite({ scope }, hasManage)
    await assertBoardHeadroom(tenantId, scope, ctx.userId)

    const sourceInstances = await DashboardInstanceService.listOnSurface(tenantId, {
      entityType: 'DASHBOARD', entityId: source.boardId,
    })
    const resolved = await resolvePlacedWidgets({
      request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds,
      refs: sourceInstances.map((i) => i.widgetRef),
    })
    // A ref this caller cannot see is dropped by `duplicate()` itself (absent
    // from the set). A ref they CAN see but that is PRIVATE to someone else is
    // dropped here instead, before it ever reaches a shared copy — the same
    // K10 rule a manual placement follows, applied per row.
    const resolvableRefs = new Set(
      [...resolved.entries()]
        .filter(([, descriptor]) => scope !== 'TENANT' || descriptor.visibility !== 'PRIVATE')
        .map(([ref]) => ref),
    )

    const commands = await commandVerdictsFor(request, tenantId, sourceInstances.map((i) => i.actions))
    let droppedCommands = 0
    const { board, skipped, droppedElementCommands } = await DashboardBoardService.duplicate(
      tenantId,
      boardId,
      { title: dto.title ?? `${source.title} (copy)`, scope },
      { userId: ctx.userId },
      resolvableRefs,
      (actions) => {
        const out = stripUnauthorisedCommands(actions, commands.allowed)
        droppedCommands += out.dropped
        return out.actions
      },
      elementAuthoringFor(request, tenantId, ctx.session),
    )
    droppedCommands += droppedElementCommands ?? 0 // a symbol command the caller may not author (`dashboard:element_actions`)
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.board.duplicate', resourceType: 'dashboard_board',
      resourceId: board.boardId, metadata: { sourceBoardId: boardId, scope, skipped: skipped.length, droppedCommands },
    })
    return NextResponse.json({ board, skipped, droppedCommands }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
