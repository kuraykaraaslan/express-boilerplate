import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService, { assertCanWrite } from './board.crud.service'
import DashboardBoardSnapshotService from './board-snapshot.service'
import { changedByLabel } from './board-snapshot.labels'
import { dashboardContext } from './dashboard.route.helpers'
import MSG from './dashboard.messages'

type Ctx = { params: Promise<{ tenantId: string; boardId: string; snapshotId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A copy id that is not a uuid names no copy (and never reaches a uuid column). */
function snapshotIdOr404(snapshotId: string): string {
  if (!UUID.test(snapshotId)) throw new AppError(MSG.BOARD_SNAPSHOT_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  return snapshotId
}

/**
 * GET …/dashboard/boards/[boardId]/snapshots/[snapshotId] — what Discard would put back (owner 2026-10-27): how many changes since
 * the caller's copy (`changes`, one per board field, card and card overlay) and whether someone else changed the board meanwhile
 * (`conflict`: who, by e-mail when they are a member, and when). The caller must still be able to write the board; another
 * person's copy is a 404.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId, snapshotId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const board = await DashboardBoardService.get(tenantId, boardId, { userId: ctx.userId })
    assertCanWrite(board, ctx.granted.has('dashboard.boards.manage'))
    const status = await DashboardBoardSnapshotService.status(tenantId, board.boardId, snapshotIdOr404(snapshotId), { userId: ctx.userId })
    const conflict = status.conflict ? { ...status.conflict, label: await changedByLabel(tenantId, status.conflict.userId) } : null
    return NextResponse.json({ ...status, conflict })
  } catch (e) {
    return normalizeError(e)
  }
}

/** DELETE …/dashboard/boards/[boardId]/snapshots/[snapshotId] — Customise is done: the caller's copy goes. Nothing when it is gone. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, boardId, snapshotId } = await params
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    await DashboardBoardSnapshotService.drop(tenantId, boardId, snapshotIdOr404(snapshotId), { userId: ctx.userId })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
