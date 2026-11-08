import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import DashboardBoardService from './board.crud.service'
import { dashboardContext } from './dashboard.route.helpers'

type Ctx = { params: Promise<{ tenantId: string; workspace: string }> }

/**
 * DELETE …/dashboard/workspaces/[workspace]/board/personal — "return to the
 * shared board" (Faz 9, K4's other half).
 *
 * Deletes only the CALLER's own PRIVATE default for this workspace — never the
 * shared one, and never another member's personal copy (`removePersonalDefault`
 * scopes by `ownerUserId` itself). A no-op when the caller had none, so this
 * is safe to offer even when it is unclear whether they are looking at a
 * personal or a shared board.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, workspace } = await params
    await Limiter.checkRateLimit(request)
    const { userId } = await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.write' })
    await DashboardBoardService.removePersonalDefault(tenantId, { workspace }, userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return normalizeError(e)
  }
}
