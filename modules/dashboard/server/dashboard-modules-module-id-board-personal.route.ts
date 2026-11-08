import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService from './board.crud.service'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; moduleId: string }> }

/**
 * DELETE …/dashboard/modules/[moduleId]/board/personal — "return to the
 * shared board", the module-board twin of
 * `dashboard-workspaces-workspace-board-personal.route.ts`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    await DashboardBoardService.removePersonalDefault(tenantId, { moduleId }, userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
