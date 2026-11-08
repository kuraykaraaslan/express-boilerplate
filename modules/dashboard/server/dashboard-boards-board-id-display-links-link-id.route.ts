import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService from './board.crud.service'
import DashboardDisplayLinkService from './display-link.service'
import { toDisplayLinkView } from './display-link.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import MSG from './dashboard.messages'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { params: Promise<{ tenantId: string; boardId: string; linkId: string }> }

/**
 * DELETE …/dashboard/boards/[boardId]/display-links/[linkId] — revoke a display link (owner decision 2026-10-17 #10).
 * The screen stops on its next request. Idempotent; a link of another board is a 404. The row stays (revoked) as the
 * list's history; only deleting the board removes it.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId, linkId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.manage' })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    // Not a link id at all: the same 404 as an unknown one, never a database type error.
    if (!UUID_RE.test(linkId)) throw new AppError(MSG.DISPLAY_LINK_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    const { link, changed } = await DashboardDisplayLinkService.revoke(tenantId, board.boardId, linkId, ctx.userId)
    // A repeated revoke changes nothing and leaves no second row.
    if (changed) {
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.display_link.revoke', resourceType: 'dashboard_display_link',
        resourceId: link.displayLinkId, metadata: { boardId: board.boardId, label: link.label, tokenHint: link.tokenHint },
      })
    }
    return NextResponse.json({ link: toDisplayLinkView(link) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return normalizeError(e)
  }
}
