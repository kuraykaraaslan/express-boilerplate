import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService from './board.crud.service'
import { SetHomeDTO } from './dashboard.dto'
import { clearHome, setHome } from './user-home'
import { dashboardContext } from './dashboard.route.helpers'
import MSG from './dashboard.messages'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * PUT …/dashboard/home `{ boardId }`: the board the caller lands on at the admin home from now on (phase 20.2e; owner 2026-10-26: "a
 * shared dashboard can be made just my home too"). Any standalone board the caller can open, a shared one included, so only reading is
 * needed: the choice is the caller's own and changes nothing for anyone else (making a board everyone's home stays `isDefault` on a
 * shared board, a shared write). A board the caller cannot open is a 404, a workspace or module board a 422.
 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    const { boardId } = SetHomeDTO.parse(await request.json())
    const board = await DashboardBoardService.get(tenantId, boardId, { userId })
    if (board.workspace || board.moduleId) throw new AppError(MSG.HOME_NOT_STANDALONE, 422, ErrorCode.VALIDATION_ERROR)
    await setHome(tenantId, userId, board.boardId)
    return NextResponse.json({ home: { boardId: board.boardId } })
  } catch (e) {
    return normalizeError(e)
  }
}

/** DELETE …/dashboard/home: the caller has no home of their own again; they land on the shared home, if there is one. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    await clearHome(tenantId, userId)
    return NextResponse.json({ home: null })
  } catch (e) {
    return normalizeError(e)
  }
}
