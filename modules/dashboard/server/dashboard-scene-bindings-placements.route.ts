import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { selectEntityType } from './entity-types'
import { sceneKindFor } from './scene-binding.access'
import { assertSubjectReadable } from './card-overlay.subject'
import { queryObject } from './scene-binding.dto'
import { PlacementsQuerySchema } from './scene-binding.placements.dto'
import { countScenePlacements, readScenePlacements } from './scene-binding.placements'
import { resolvePlacedWidgets } from './widget-catalog.service'
import { dashboardContext } from './dashboard.route.helpers'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/scene-bindings/placements?subjectType=&subjectId=&kind=[&slot=] — where one view of a subject is shown (phase 48.3, the line under
 * the view on the Scene tab): `{ shown, fixed, fixedBoards }`, the boards that show the subject in a card of the view's kind, how many of them keep a
 * picture of their own, and those boards' titles while there are at most three (`scene-binding.placements.ts` says what is counted and what cannot be).
 *
 * Gates, as the other scene reads: the board read access, the kind's own read permission (404 for an unknown kind, 403 without it) and the subject
 * type's read permission (`assertSubjectReadable`, 404 for a type this build lacks). Only the boards the caller may open are read and only the widgets
 * the caller may see are counted, so the answer names no board the caller could not open. The caller's tenant only.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const q = PlacementsQuerySchema.parse(queryObject(request.nextUrl.searchParams))
    await sceneKindFor(request, tenantId, q.kind, 'read')
    const subject = { type: q.subjectType, id: q.subjectId }
    await assertSubjectReadable(request, tenantId, subject)
    // the subject's subtype (a device's profile, a site's kind): what a board that lists its subjects by subtype names
    const found = await (await selectEntityType(tenantId, subject.type)).byIds({ tenantId, locale: await appLocaleOf(request, tenantId) }, [subject.id])
    const subtype = found.find((e) => e.id.toLowerCase() === subject.id.toLowerCase())?.subtype ?? null
    const { boards, cards } = await readScenePlacements(tenantId, { userId: ctx.userId }, subject, subtype, ctx.enabledIds)
    const widgets = cards.length
      ? await resolvePlacedWidgets({ request, tenantId, session: ctx.session, userId: ctx.userId, scope: ctx.scope, enabledIds: ctx.enabledIds, refs: [...new Set(cards.map((c) => c.widgetRef))] })
      : new Map()
    return NextResponse.json(countScenePlacements({
      boards, cards, subject, subtype, kind: q.kind, slot: q.slot, sceneKindOf: (ref) => widgets.get(ref)?.sceneKind,
    }))
  } catch (e) {
    return normalizeError(e)
  }
}
