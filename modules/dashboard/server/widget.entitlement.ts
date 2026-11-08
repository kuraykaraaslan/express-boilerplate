import { resolveLimit } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.headroom'
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardWidgetService from './widget.crud.service'
import MSG from './dashboard.messages'

/** Free baseline for tenant-authored widgets; seeded ones never count. */
export const FREE_MAX_CUSTOM_WIDGETS = 10

/**
 * How many custom widgets this tenant may author. `Infinity` = unlimited.
 * Fails OPEN (docs/phases/31-feature-gate P1): a billing-rail outage must not stop
 * someone editing the widget they are halfway through.
 */
export async function resolveWidgetLimit(tenantId: string): Promise<number> {
  const limit = await resolveLimit(tenantId, FEATURE_KEYS.MAX_DASHBOARD_CUSTOM_WIDGETS, {
    freeBaseline: FREE_MAX_CUSTOM_WIDGETS, onGateError: 'open',
  })
  return limit === Infinity ? Infinity : Math.max(1, limit)
}

/**
 * Throw 403 when one more widget of this visibility would exceed its headroom. The two
 * visibilities spend two budgets (dashboard.05, the widget twin of the boards' Faz 9 K5 fix):
 * a `TENANT` widget counts against the tenant's shared plan limit, a `PRIVATE` one against its
 * owner's own count under the same limit, so members filling their private libraries can never
 * lock an admin out of the tenant's first shared widget.
 */
export async function assertWidgetHeadroom(
  tenantId: string,
  visibility: 'TENANT' | 'PRIVATE' = 'TENANT',
  userId?: string,
): Promise<void> {
  const limit = await resolveWidgetLimit(tenantId)
  if (limit === Infinity) return
  const used = visibility === 'PRIVATE' && userId
    ? await DashboardWidgetService.countPrivate(tenantId, userId)
    : await DashboardWidgetService.count(tenantId)
  if (used >= limit) {
    throw new AppError(MSG.WIDGET_LIMIT_REACHED, 403, ErrorCode.FORBIDDEN)
  }
}
