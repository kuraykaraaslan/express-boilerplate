import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { memberLabels } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.read.service'
import DashboardDisplayLinkService from './display-link.service'
import { toDisplayLinkView } from './display-link.dto'
import { dashboardContext } from './dashboard.route.helpers'

/**
 * GET …/dashboard/display-links — the live display links on personal boards of the workspace (phase 39 review of INC-03). A
 * private board reads as absent to everyone but its owner, so its links never show in a board's own list for another manager;
 * here every manager sees them (the screen's name, its token hint, its expiry and last use, and whose board it shows) and can
 * revoke one by its id (`dashboard-display-links-link-id.route.ts`). The board's title and content are not part of the answer.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.manage' })
    const rows = await DashboardDisplayLinkService.listOnPersonalBoards(tenantId)
    const owners = await memberLabels(tenantId, rows.map((r) => r.ownerUserId)).catch(() => ({} as Record<string, string>))
    const links = rows.map(({ link, ownerUserId }) => ({
      ...toDisplayLinkView(link),
      boardId: link.boardId,
      ownerUserId,
      ownerLabel: ownerUserId ? owners[ownerUserId] ?? null : null,
    }))
    return NextResponse.json({ links }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return normalizeError(e)
  }
}
