import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import type { DashboardBoard } from './entities/dashboard_board.entity'
import DashboardBoardService, { type BoardViewer } from './board.crud.service'
import MSG from './dashboard.messages'

/**
 * The board a placement sits on, read through the viewer-aware getter, for a route that was addressed
 * by the PLACEMENT id. A board the viewer may not see answers exactly like a missing placement
 * (dashboard.10): "Dashboard not found" for a real placement would tell a uuid holder it exists.
 * Only a `DASHBOARD` surface has a known visibility rule; any other surface fails closed the same way
 * (dashboard.08) until that surface registers its own rule.
 */
export async function placementBoardOr404(
  tenantId: string,
  instance: { entityType: string; entityId: string },
  viewer: BoardViewer,
): Promise<DashboardBoard> {
  if (instance.entityType !== 'DASHBOARD') throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  try {
    return await DashboardBoardService.get(tenantId, instance.entityId, viewer)
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 404) throw new AppError(MSG.INSTANCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    throw e
  }
}
