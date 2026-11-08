import { resolveLimit } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.headroom'
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardBoardService from './board.crud.service'
import MSG from './dashboard.messages'

/**
 * Free baseline: how many SHARED dashboards a tenant keeps without a paid plan.
 * Enough that arranging the workspaces they use is never blocked; a tenant
 * building a board per team is the case a plan is for.
 */
export const FREE_MAX_BOARDS = 5

/**
 * Hard cap on one user's own PRIVATE boards (Faz 9, K5) — a usage ceiling, not
 * a priced feature. Before Faz 9 a tenant's board count was ONE number
 * covering every scope, so five members "customising" their own workspace
 * view could fill a free tenant's whole shared-board quota and lock an ADMIN
 * out of creating a real one; personal boards now spend a separate, per-user
 * budget that a plan cannot buy more of and a tenant's plan cannot exhaust.
 */
export const MAX_PERSONAL_BOARDS_PER_USER = 20

/**
 * How many SHARED dashboards this tenant may keep. `Infinity` = unlimited.
 *
 * Mirrors `dynamic_page.entitlement`: the root tenant is unlimited, the plan's
 * LIMIT wins when there is one, and any gate error FAILS OPEN — a transient
 * outage in the billing rail must not stop someone rearranging their dashboard.
 */
export async function resolveBoardLimit(tenantId: string): Promise<number> {
  // docs/phases/31-feature-gate/01 adoption — behaviour preserved: onGateError 'open', baseline 5, plan limit floored at 1.
  const limit = await resolveLimit(tenantId, FEATURE_KEYS.MAX_DASHBOARD_BOARDS, {
    freeBaseline: FREE_MAX_BOARDS, onGateError: 'open',
  })
  return limit === Infinity ? Infinity : Math.max(1, limit)
}

/**
 * Throw 403 when creating one more board of this SCOPE would exceed its
 * headroom (Faz 9, K5). The two scopes spend two different budgets: a
 * `TENANT` board counts against the tenant's plan limit, a `PRIVATE` one
 * against its owner's fixed personal cap — so a tenant sitting at its shared
 * quota can still let members keep their own views, and a member filling
 * their personal quota never touches what the tenant can share.
 */
export async function assertBoardHeadroom(
  tenantId: string,
  scope: 'TENANT' | 'PRIVATE',
  userId: string,
  /** How many boards are about to be created (a bundle import, 19.6, creates them all or none). */
  adding = 1,
): Promise<void> {
  const extra = Math.max(1, adding) - 1
  if (scope === 'PRIVATE') {
    const used = await DashboardBoardService.countPersonal(tenantId, userId)
    if (used + extra >= MAX_PERSONAL_BOARDS_PER_USER) throw boardLimitError('PRIVATE', used, MAX_PERSONAL_BOARDS_PER_USER)
    return
  }
  const limit = await resolveBoardLimit(tenantId)
  if (limit === Infinity) return
  const used = await DashboardBoardService.countShared(tenantId)
  if (used + extra >= limit) throw boardLimitError('TENANT', used, limit)
}

/**
 * The 403 of a full quota, with what the New board dialog shows (phase 39, UX-14): which budget is full, how many boards
 * spend it and its limit. The seeded sample boards are shared boards and count (owner decision INC-03, 2026-10-27).
 */
export function boardLimitError(scope: 'TENANT' | 'PRIVATE', used: number, limit: number): AppError {
  return scope === 'PRIVATE'
    ? new AppError(MSG.PERSONAL_BOARD_LIMIT_REACHED, 403, ErrorCode.FORBIDDEN, { details: { reason: 'personal_board_limit', used, limit } })
    : new AppError(MSG.BOARD_LIMIT_REACHED, 403, ErrorCode.FORBIDDEN, { details: { reason: 'shared_board_limit', used, limit } })
}

/** How many shared boards the tenant holds and may hold (`limit` null: unlimited), for the boards list (UX-14). */
export async function sharedBoardQuota(tenantId: string): Promise<{ used: number; limit: number | null }> {
  const [limit, used] = await Promise.all([resolveBoardLimit(tenantId), DashboardBoardService.countShared(tenantId)])
  return { used, limit: limit === Infinity ? null : limit }
}
