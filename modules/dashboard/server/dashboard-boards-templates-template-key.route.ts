import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { dashboardContext } from './dashboard.route.helpers'
import { findBoardTemplate } from './board-template.registry'
import { resolveTemplateWidgets, expandTemplate } from './board-template.resolve'
import { partitionPlacements } from './board-template.service'
import MSG from './dashboard.messages'
import { normalizeGridCols } from './grid-cols'
import { requiredModulesOn } from './board-templates'
import { templateInLocale } from './board-template.texts'
import { templateLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string; templateKey: string }> }

/** The synthetic id prefix of a transient placement — never a database id, never accepted by a write route. */
export const TRANSIENT_ID_PREFIX = 'tpl:'

/**
 * GET …/dashboard/boards/templates/[templateKey] — a template rendered READ-ONLY
 * without creating a board (docs/phases/07-dashboard/13, "transient render").
 *
 * For any "detail board per record" use — a device page, a customer, a store —
 * where a `dashboard_boards` row per record would be wrong. The payload has the
 * shape of `GET …/boards/[boardId]`, so `BoardView` renders it with no special
 * casing, but: placements are resolved and permission-filtered EXACTLY as apply
 * does (`resolveTemplateWidgets`), the "board" is synthetic (`canWrite: false`,
 * no id a write route would accept), and the viewer's window / params travel in
 * the query request as `boardContext.templateKey`, never stored. "Duplicate"
 * turns the view into a real, personal board (`POST …/apply` with `asCopy`).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, templateKey } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const found = await findBoardTemplate(templateKey, tenantId)
    // a template whose cards read a module the tenant has off is not there (R49b-3, `requires`)
    const expanded = found && requiredModulesOn(found, ctx.enabledIds) ? await expandTemplate(tenantId, found) : null
    if (!expanded || !expanded.placements?.length) throw new AppError(MSG.TEMPLATE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    // D118 (e): the preview says what an apply would store, in the viewer's language
    const template = await templateInLocale(expanded, await templateLocaleOf(request, tenantId))

    const { descriptors, resolvable } = await resolveTemplateWidgets({ request, tenantId, ctx, template, targetScope: 'PRIVATE' })
    const { keep, skipped } = partitionPlacements(template.placements ?? [], resolvable)
    const instances = keep.map((p, i) => ({
      instanceId: `${TRANSIENT_ID_PREFIX}${template.key}:${i}`,
      widgetRef: p.widgetRef,
      x: p.x, y: p.y, w: p.w, h: p.h, order: (i + 1) * 10,
      settings: p.settings ?? {},
      dataBinding: p.dataBinding ?? null,
      actions: p.actions ?? null,
      title: p.title ?? null,
      refreshSeconds: p.refreshSeconds ?? null,
      // Phase 29: a transient render shows the template's pages like the board it would make.
      pageKey: p.pageKey ?? null,
    }))
    return NextResponse.json({
      board: {
        boardId: `${TRANSIENT_ID_PREFIX}${template.key}`,
        title: template.title,
        description: template.description ?? null,
        revision: 0,
        scope: 'PRIVATE',
        workspace: template.anchor.workspace ?? null,
        moduleId: template.anchor.moduleId ?? null,
        canWrite: false,
        layoutVersion: 2,
        gridCols: normalizeGridCols(template.gridCols),
        timeWindow: template.timeWindow ?? null,
        params: template.params ?? null,
        pages: template.pages ?? null,
        mainPage: template.mainPage ?? null,
        transient: true,
      },
      instances,
      widgets: Object.fromEntries(descriptors),
      skipped,
    })
  } catch (e) {
    return normalizeError(e)
  }
}
