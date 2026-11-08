import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { moduleRegistry } from '@kuraykaraaslan-labs/common/server/module-registry'
import DashboardBoardService, { assertModuleReachable } from './board.crud.service'
import DashboardInstanceService from './instance.crud.service'
import { resolveModuleWidgets } from './widget-catalog.service'
import { assertBoardHeadroom } from './dashboard.entitlement'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; moduleId: string }> }

/** GET …/dashboard/modules/[moduleId]/board — the module's default board, or null. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    assertModuleReachable(moduleId, ctx.enabledIds)
    return NextResponse.json({
      board: await DashboardBoardService.findDefault(tenantId, { userId: ctx.userId }, { moduleId }),
    })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/modules/[moduleId]/board — start editing this module's board.
 *
 * Mirrors `dashboard-workspaces-workspace-board.route.ts` exactly, anchored on
 * `moduleId` instead of `workspace`: implicit until customised, materializes
 * what the caller currently sees (`resolveModuleWidgets`), and without
 * `dashboard.boards.manage` seeds the caller's own PRIVATE default rather than
 * the module's shared one (K4).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    assertModuleReachable(moduleId, ctx.enabledIds)

    const existing = await DashboardBoardService.findDefault(tenantId, { userId: ctx.userId }, { moduleId })
    if (existing) return NextResponse.json({ board: existing, created: false })

    const hasManage = ctx.granted.has('dashboard.boards.manage')
    await assertBoardHeadroom(tenantId, hasManage ? 'TENANT' : 'PRIVATE', ctx.userId)
    const widgets = await resolveModuleWidgets({
      request, tenantId, session: ctx.session, moduleId, scope: ctx.scope, enabledIds: ctx.enabledIds,
    })

    const module_ = moduleRegistry.getModule(moduleId)
    const title = module_?.name ?? moduleId
    const board = await DashboardBoardService.create(
      tenantId,
      hasManage
        ? { slug: `mod-${moduleId}`, title, moduleId, scope: 'TENANT', isDefault: true }
        : {
            // A per-user slug: two members without `manage` both customising the
            // same module board must not collide on `@Unique(['tenantId', 'slug'])`.
            slug: `mod-${moduleId}-${ctx.userId}`.slice(0, 64),
            title,
            moduleId,
            scope: 'PRIVATE',
            isDefault: true,
          },
      { userId: ctx.userId },
    )
    await DashboardInstanceService.materialize(
      tenantId,
      { entityType: 'DASHBOARD', entityId: board.boardId },
      widgets.map((w) => ({ ref: w.ref, w: w.w, settings: w.defaultProps })),
    )
    return NextResponse.json({ board, created: true }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
