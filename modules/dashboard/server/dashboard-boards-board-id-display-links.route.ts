import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url'
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service'
import DashboardBoardService from './board.crud.service'
import DashboardDisplayLinkService from './display-link.service'
import DashboardInstanceService from './instance.crud.service'
import { CreateDisplayLinkDTO, toDisplayLinkView } from './display-link.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { issuerEligible } from './display-principal'
import { auditBoardWrite } from './dashboard.audit'
import MSG from './dashboard.messages'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/** The management responses name links (and the POST carries the token): never cached anywhere. */
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * GET …/dashboard/boards/[boardId]/display-links — every display link of a shared board (owner decision 2026-10-17
 * #10): label, hint, status, expiry, last use, and for a live link whether its issuer still qualifies. Never a token
 * or a hash.
 *
 * `dashboard.boards.manage` is the entry gate (first, before anything touches the database): a display link puts a
 * shared board on a screen nobody signs in to, which is a decision about the board, not about one's own view of it.
 *
 * `hiddenCards`: the cards whose widget is private to its author, which a screen never shows (`displayRenderable`). Only a
 * personal board can have them (K10); its owner may show it on a screen since INC-03, and is told which cards stay off it.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.manage' })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const rows = await DashboardDisplayLinkService.list(tenantId, board.boardId)
    const now = new Date()
    // Whether each live link's issuer could still lend their authority: why a screen stopped, before anyone walks to
    // it. At most 20 live links per board (the cap), each decided as the screen would be.
    const links = await Promise.all(rows.map(async (r) => {
      const view = toDisplayLinkView(r, now)
      return view.status === 'active' ? { ...view, issuerEligible: await issuerEligible(request, tenantId, r) } : view
    }))
    const hiddenCards = (await DashboardInstanceService.privateWidgetCards(tenantId, board.boardId))
      .map((c) => ({ instanceId: c.instanceId, title: c.title || c.widgetName }))
    return NextResponse.json({ links, hiddenCards }, { headers: NO_STORE })
  } catch (e) {
    return normalizeError(e)
  }
}

/**
 * POST …/dashboard/boards/[boardId]/display-links — mint a link. Answers 201 with the raw token and the screen URL
 * ONCE; only the hash is stored, so a lost link is replaced, not recovered.
 *
 * The issuer is the link's authority for as long as it lives (the display principal caps every screen request at
 * them), so they must be a real member acting as themselves: a global admin or an impersonator
 * would leave a long-lived credential borrowing someone else's (or no one's) membership. Those are refused 422.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.manage' })
    if (ctx.auth.isGlobalAdmin || ctx.auth.isImpersonating) {
      throw new AppError(MSG.DISPLAY_LINK_ISSUER_NOT_MEMBER, 422, ErrorCode.VALIDATION_ERROR)
    }
    const dto = CreateDisplayLinkDTO.parse(await request.json())
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    const member = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId: ctx.userId })
    if (!member) throw new AppError(MSG.DISPLAY_LINK_ISSUER_NOT_MEMBER, 422, ErrorCode.VALIDATION_ERROR)

    const { link, token } = await DashboardDisplayLinkService.create(tenantId, board, dto, ctx.userId)
    const view = toDisplayLinkView(link)
    await auditBoardWrite({
      tenantId, userId: ctx.userId, action: 'dashboard.display_link.create', resourceType: 'dashboard_display_link',
      resourceId: link.displayLinkId, metadata: { boardId: board.boardId, label: link.label, expiresAt: view.expiresAt, tokenHint: link.tokenHint },
    })
    // Decision 2026-10-18 #19: the token goes in the fragment, which never reaches a server, a proxy log or a Referer.
    const url = `${await absoluteTenantUrl(tenantId, '/display')}#${token}`
    return NextResponse.json({ link: view, token, url }, { status: 201, headers: NO_STORE })
  } catch (e) {
    return normalizeError(e)
  }
}
