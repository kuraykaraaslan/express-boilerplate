import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { assertCanWrite } from './board.crud.service'
import DashboardBoardSnapshotService, { type CardGate } from './board-snapshot.service'
import { withChangedByLabel } from './board-snapshot.labels'
import { RestoreBoardDTO } from './dashboard.dto'
import { dashboardContext } from './dashboard.route.helpers'
import { auditBoardWrite } from './dashboard.audit'
import { assertCommandAuthoring } from './command.service'
import { elementAuthoringFor } from './element-authoring'
import { dropElementCommandsWithoutPermission } from './element-actions.registry'
import MSG from './dashboard.messages'

type Ctx = { params: Promise<{ tenantId: string; boardId: string }> }

/**
 * POST …/dashboard/boards/[boardId]/restore — Discard in Customise (owner 2026-10-27): the board put back as the caller's copy holds
 * it (`snapshotId`, taken when they started customising), its content, cards and card overlays, in one transaction under the board's
 * lock (`DashboardBoardSnapshotService.restore`). Guarded as the layout save is: `dashboard.boards.write`, and `manage` for a shared
 * board.
 *
 * Someone else's change since the copy is a 409 (`details.changedBy`, `changedByLabel`, `changedAt`) with nothing written; the editor
 * then offers to keep the board as it is or to overwrite (`overwrite: true`). An overwrite brings back cards the caller did not
 * take away themselves, so the actions it writes pass the same authoring gates as a hand edit: a command they could not run, or a
 * symbol command they may not author, refuses the whole restore. `skipped` names the cards left out because their widget was
 * deleted since.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { tenantId, boardId } = await params
  try {
    await Limiter.checkRateLimit(request)
    const ctx = await dashboardContext({
      request, tenantId, requiredPermission: 'dashboard.boards.write',
      alsoCheck: ['dashboard.boards.manage'],
    })
    const dto = RestoreBoardDTO.parse(await request.json())
    const authoring = elementAuthoringFor(request, tenantId, ctx.session)
    const gateCard: CardGate = async ({ actions, kindType }) => {
      await assertCommandAuthoring(request, tenantId, actions)
      const { dropped } = await dropElementCommandsWithoutPermission(tenantId, kindType, actions, authoring)
      if (dropped > 0) throw new AppError(MSG.ELEMENT_COMMAND_AUTHORING_FORBIDDEN, 403, ErrorCode.FORBIDDEN)
    }
    const { revision, changes, skipped } = await DashboardBoardSnapshotService.restore(tenantId, boardId, dto.snapshotId, { userId: ctx.userId }, {
      overwrite: dto.overwrite === true,
      authorize: (board) => assertCanWrite(board, ctx.granted.has('dashboard.boards.manage')),
      gateCard,
    })
    // A copy the board already matched wrote nothing, so there is nothing to audit.
    if (changes.changes > 0) {
      await auditBoardWrite({
        tenantId, userId: ctx.userId, action: 'dashboard.board.restore', resourceType: 'dashboard_board',
        resourceId: boardId, metadata: { revision, overwrite: dto.overwrite === true, ...changes, skipped: skipped.length },
      })
    }
    return NextResponse.json({ revision, changes, skipped })
  } catch (e) {
    return normalizeError(await withChangedByLabel(tenantId, e))
  }
}
