import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardWidgetService, { dbRef } from './widget.crud.service'
import { toDbDescriptor, resolveWorkspaceWidgets, activeCustomRoleKeys, widgetLabelModules } from './widget-catalog.service'
import { appLocaleOf } from './board-template.locale'
import { contributedLabelTexts } from './contributed-label-texts'
import { CreateWidgetDTO } from './widget.dto'
import { assertWidgetHeadroom } from './widget.entitlement'
import { assertCanAuthor } from './widget-authoring.acl'
import { assertWritableCategory, listWidgetCategories } from './widget-category.registry'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite, changedKeys } from './dashboard.audit'
import { needsCustomRoles, widgetAllowsMember } from './widget-roles.acl'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/widgets — the library: the union of what a caller can use.
 *
 * One endpoint for both origins because the library's tabs are a VIEW over one
 * catalog, not three separate lists. Manifest widgets are the System shelf,
 * tenant-authored rows are Tenant and My Widgets (split by `visibility`), and
 * favourites are a flag on the same entries rather than a fourth source.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read', alsoCheck: ['dashboard.widgets.author'] })
    const sp = new URL(request.url).searchParams

    // The new-widget and save-as-widget forms only need the category list; they
    // must not pay for (or wait on) the whole catalog to fill a <select>.
    // D551, phase 39.16: names, settings and categories in the workspace's language (the person's app language), never the browser's
    const locale = await appLocaleOf(request, tenantId)
    if (sp.get('only') === 'categories') {
      return NextResponse.json({ categories: await listWidgetCategories(tenantId, locale) })
    }

    const labels = await contributedLabelTexts(locale, widgetLabelModules())
    const manifest = await resolveWorkspaceWidgets({
      request, tenantId, session: ctx.session, scope: ctx.scope, enabledIds: ctx.enabledIds, labels,
      workspace: sp.get('workspace') ?? undefined,
      // Dilim 9.4: a module-anchored board's add-widget drawer passes `moduleId`
      // instead — ignored by `resolveWorkspaceWidgets` when `workspace` is set,
      // so a caller never sends both.
      moduleId: sp.get('moduleId') ?? undefined,
    })
    const listed = await DashboardWidgetService.list(tenantId, { userId: ctx.userId }, {
      status: sp.get('status') ?? undefined,
      category: sp.get('category') ?? undefined,
      search: sp.get('search') ?? undefined,
    })
    const activeKeys = ctx.session.tenantMember?.roleKeys?.length && needsCustomRoles(listed)
      ? await activeCustomRoleKeys(tenantId)
      : undefined
    // Decision 2026-10-17 #2: a widget whose `allowedRoles` exclude the caller is not shown to a caller who may neither
    // place it nor author widgets (its own author always sees it). Data access stays with the sources' permissions.
    const canAuthor = ctx.granted.has('dashboard.widgets.author')
    const authored = listed.filter((w) => canAuthor || w.ownerUserId === ctx.userId || widgetAllowsMember(w, ctx.session.tenantMember, activeKeys))
    const usage = await DashboardWidgetService.usageCounts(tenantId, authored.map((w) => w.widgetId))
    const favorites = await DashboardWidgetService.listFavorites(tenantId, ctx.userId)

    return NextResponse.json({
      // The picker orders its tabs by this (core + enabled modules' contributions).
      categories: await listWidgetCategories(tenantId, locale),
      // The caller's real `dashboard.widgets.author` grant (15.2a), so the library
      // offers "Everyone" visibility from the permission, not from `memberRole`.
      canAuthor,
      widgets: [...manifest, ...authored.map((w) => toDbDescriptor(w, labels))],
      // Kept alongside rather than folded in: a descriptor is what a board needs
      // to render, and library-only bookkeeping has no business travelling with it.
      meta: {
        favorites,
        authored: authored.map((w) => ({
          widgetId: w.widgetId,
          status: w.status,
          visibility: w.visibility,
          isSystem: w.isSystem,
          publishedVersion: w.publishedVersion,
          updatedAt: w.updatedAt,
          usedBy: usage.get(dbRef(w.widgetId)) ?? 0,
          // `allowedRoles` excludes this caller: the library still lists it (its author edits it there), the picker
          // does not offer it, and a placement of it is a 403 (owner decision 2026-10-16).
          placeable: widgetAllowsMember(w, ctx.session.tenantMember, activeKeys),
        })),
      },
    })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/widgets — author a new widget (starts as a DRAFT).
 *
 * K11: the entry gate is the loosest permission that can ever legitimately
 * reach here — `author_private`, since every USER may create their OWN
 * `PRIVATE` widget — and `assertCanAuthor` then decides whether THIS caller
 * may create one at the `visibility` the body actually asked for, the same
 * two-step `dashboard.boards.manage` already uses for a shared board.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.widgets.author_private',
      alsoCheck: ['dashboard.widgets.author'],
    })
    const dto = CreateWidgetDTO.parse(await request.json())
    await assertWritableCategory(dto.category, tenantId)
    assertCanAuthor(dto.visibility, dto.visibility, ctx.granted.has('dashboard.widgets.author'))
    await assertWidgetHeadroom(tenantId, dto.visibility, ctx.userId)
    const widget = await DashboardWidgetService.create(tenantId, dto, { userId: ctx.userId })
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.widget.create', resourceType: 'dashboard_widget',
      resourceId: widget.widgetId, metadata: { type: widget.type, visibility: widget.visibility },
    })
    return NextResponse.json({ widget }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
