import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardDisplayLinkService from './display-link.service'
import { toDisplayLinkView } from './display-link.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import MSG from './dashboard.messages'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ctx = { params: Promise<{ tenantId: string; linkId: string }> }

/**
 * DELETE …/dashboard/display-links/[linkId] — revoke a display link by its id, whatever board it shows (phase 39 review of
 * INC-03): a manager stops the screen of someone else's personal board, which they cannot open. Idempotent, audited as a
 * board's own revoke is; the board is never read, so its existence and title stay its owner's.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, linkId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.manage' })
    if (!UUID_RE.test(linkId)) throw new AppError(MSG.DISPLAY_LINK_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    const { link, changed } = await DashboardDisplayLinkService.revokeById(tenantId, linkId, ctx.userId)
    if (changed) {
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.display_link.revoke', resourceType: 'dashboard_display_link',
        resourceId: link.displayLinkId, metadata: { boardId: link.boardId, label: link.label, tokenHint: link.tokenHint },
      })
    }
    return NextResponse.json({ link: toDisplayLinkView(link) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return normalizeError(e)
  }
}
