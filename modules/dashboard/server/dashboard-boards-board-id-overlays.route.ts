import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService from './board.crud.service'
import DashboardCardOverlayService, { toCardOverlayView } from './card-overlay.service'
import { subjectFromQuery } from './card-overlay.dto'
import { assertSubjectReadable } from './card-overlay.subject'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/**
 * GET …/dashboard/boards/[boardId]/overlays?subjectType=&subjectId= — the cards of a board customised for one subject (phase 38, E38-9):
 * `{ overlays: [{ instanceId, settings (a merge patch on the card's settings), title, revision }] }`, read once per subject by the
 * viewer and merged before the cards draw. Without a subject: `{ subjects }`, every subject that has an overlay on the board (the
 * editor marks them).
 *
 * Behind the board's own read access (a private board of someone else is a 404) and the subject type's read permission.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const subject = subjectFromQuery(request.nextUrl.searchParams)
    if (!subject) return NextResponse.json({ subjects: await DashboardCardOverlayService.subjectsOnBoard(tenantId, board.boardId) })
    await assertSubjectReadable(request, tenantId, subject)
    const rows = await DashboardCardOverlayService.listForSubject(tenantId, board.boardId, subject)
    return NextResponse.json({ overlays: rows.map(toCardOverlayView) })
  } catch (e) {
    return normalizeError(e)
  }
}
