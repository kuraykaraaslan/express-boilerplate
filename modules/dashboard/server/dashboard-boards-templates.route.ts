import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { dashboardContext } from './dashboard.route.helpers'
import { listBoardTemplates } from './board-template.registry'
import { normalizeGridCols } from './grid-cols'
import { requiredModulesOn, templatesForModule, templatesForNewBoard, templatesForWorkspace, templateCardCount } from './board-templates'
import { askedParam } from './board-template.answers'
import { templateInLocale } from './board-template.texts'
import { templateLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/boards/templates?workspace=<id> | ?moduleId=<id> | ?for=new — the gallery (`for=new`: the New dashboard dialog's, phase 49b).
 *
 * Built-in plus contributed templates of ENABLED modules, serialised for the
 * picker. A contributed template cannot be imported by the browser (it is server
 * code behind the extension registry), so the gallery is a read, not a local
 * lookup. Only what a preview needs travels: titles, counts and the placements'
 * geometry — no data bindings.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const pool = await listBoardTemplates(tenantId)
    const workspace = request.nextUrl.searchParams.get('workspace')
    const moduleId = request.nextUrl.searchParams.get('moduleId')
    // a template whose cards read a module the tenant has off is in no gallery (R49b-3, `requires`)
    const usable = pool.filter((t) => requiredModulesOn(t, ctx.enabledIds))
    const chosen = request.nextUrl.searchParams.get('for') === 'new'
      ? templatesForNewBoard(usable, ctx.enabledIds)
      : workspace ? templatesForWorkspace(workspace, usable) : moduleId ? templatesForModule(moduleId, usable) : []
    // D118 (e): the cards' and sections' titles of each preview in the viewer's app language, as an apply would store them
    const locale = await templateLocaleOf(request, tenantId)
    const picked = await Promise.all(chosen.map((t) => templateInLocale(t, locale)))
    return NextResponse.json({
      templates: picked.map((t) => ({
        key: t.key,
        title: t.title,
        description: t.description ?? null,
        anchor: t.anchor,
        cardCount: templateCardCount(t),
        sections: (t.sections ?? []).map((s) => ({ title: s.title, count: s.countableKeys.length })),
        // The preview draws the main page (phase 29: other pages' cards would sit on the same cells).
        placements: (t.placements ?? []).filter((p) => !p.pageKey).map((p) => ({ widgetRef: p.widgetRef, x: p.x, y: p.y, w: p.w, h: p.h, title: p.title ?? null })),
        gridCols: normalizeGridCols(t.gridCols),
        hasWindow: !!t.timeWindow,
        paramCount: t.params?.length ?? 0,
        pageCount: t.pages?.length ?? 0,
        // phase 49b: the contributor's words for the title and the description, and the question a new board asks (with the entity type its
        // pickers read: the subtypes and the entities the person picks from)
        ...(t.titleKey ? { titleKey: t.titleKey } : {}),
        ...(t.descriptionKey ? { descriptionKey: t.descriptionKey } : {}),
        ...(t.ask && askedParam(t) ? { ask: { ...t.ask, entityType: askedParam(t)!.entityType } } : {}),
      })),
    })
  } catch (e) {
    return normalizeError(e)
  }
}
