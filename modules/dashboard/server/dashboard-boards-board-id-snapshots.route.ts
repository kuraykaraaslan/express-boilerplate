import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { assertCanWrite } from './board.crud.service'
import DashboardBoardSnapshotService from './board-snapshot.service'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/**
 * POST …/dashboard/boards/[boardId]/snapshots — the copy Discard puts back (owner 2026-10-27), taken when the caller starts
 * customising the board. Only someone who may write the board takes one (as the layout save asks it), and it replaces their earlier
 * copy of the board. Answers the copy's id and the board's revision it holds; the editor offers Discard once the revision moves.
 * Not audited: nothing about the board changes.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const snapshot = await DashboardBoardSnapshotService.take(
      tenantId, boardId, { userId: ctx.userId },
      (board) => assertCanWrite(board, ctx.granted.has('dashboard.boards.manage')),
    )
    return NextResponse.json({ snapshot }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
