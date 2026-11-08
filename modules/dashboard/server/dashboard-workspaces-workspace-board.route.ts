import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolveWorkspaceWidgets } from './widget-catalog.service'
import { assertBoardHeadroom } from './dashboard.entitlement'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; workspace: string }> }

/** GET …/dashboard/workspaces/[workspace]/board — the default board, or null. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, workspace } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    return NextResponse.json({
      board: await DashboardBoardService.findDefault(tenantId, { userId }, { workspace }),
    })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/workspaces/[workspace]/board — start editing this workspace.
 *
 * Until someone edits it, a workspace dashboard is IMPLICIT: there are no rows,
 * and the page renders whatever the manifests contribute. This endpoint turns that
 * into a real board by writing one placement per widget the caller can currently
 * see, in the order and at the widths they are already looking at.
 *
 * Doing it here rather than on first page load is what keeps the migration
 * lossless in both directions: pressing "customise" never rearranges anything,
 * and a tenant who never presses it keeps the manifest-driven behaviour with zero
 * rows written. Idempotent — a second call returns the board that already exists
 * instead of seeding a duplicate.
 *
 * Faz 9, K4: a caller without `dashboard.boards.manage` cannot turn the WORKSPACE
 * home into a shared row — that is the exact write this module used to allow any
 * USER to make (§1's canonical open). They get a PRIVATE one instead, `isDefault`
 * for their own view only: `findDefault` already prefers a caller's personal
 * default over the shared one, so nobody else's screen changes and this caller's
 * next `GET` on this route returns the same personal board it just created.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, workspace } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })

    const existing = await DashboardBoardService.findDefault(tenantId, { userId: ctx.userId }, { workspace })
    if (existing) return NextResponse.json({ board: existing, created: false })

    const hasManage = ctx.granted.has('dashboard.boards.manage')
    await assertBoardHeadroom(tenantId, hasManage ? 'TENANT' : 'PRIVATE', ctx.userId)
    const widgets = await resolveWorkspaceWidgets({
      request, tenantId, session: ctx.session, workspace, scope: ctx.scope, enabledIds: ctx.enabledIds,
    })

    const board = await DashboardBoardService.create(
      tenantId,
      hasManage
        ? {
            slug: `ws-${workspace}`,
            title: workspace.charAt(0).toUpperCase() + workspace.slice(1),
            workspace,
            scope: 'TENANT',
            isDefault: true,
          }
        : {
            // A per-user slug: two members without `manage` both customising the
            // same workspace must not collide on `@Unique(['tenantId', 'slug'])`.
            slug: `ws-${workspace}-${ctx.userId}`.slice(0, 64),
            title: workspace.charAt(0).toUpperCase() + workspace.slice(1),
            workspace,
            scope: 'PRIVATE',
            isDefault: true,
          },
      { userId: ctx.userId },
    )
    await DashboardInstanceService.materialize(
      tenantId,
      { entityType: 'DASHBOARD', entityId: board.boardId },
      widgets.map((w) => ({ ref: w.ref, w: w.w })),
    )
    return NextResponse.json({ board, created: true }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
