import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'

/**
 * K10 (docs/phases/07-dashboard 09): a `PRIVATE` widget cannot be placed on a `TENANT`
 * board.
 *
 * Without this, `resolvePlacedWidgets` would resolve the widget for its owner
 * and drop it to a silent gap for everyone else the board is shared with — a
 * board that renders differently depending on who is looking at it, with
 * nothing on screen to say why. Refusing the placement up front is the honest
 * failure; the person placing it can share the widget first if that is what
 * they meant to do.
 *
 * Pure and deliberately free of service/db imports — `widget-catalog.service.ts`
 * imports `auth_abac`'s `grantedPermissions`, whose chain boots env at import
 * time, so a unit test for this predicate would otherwise need a full
 * DATABASE_URL/token-secret environment for logic that touches no row. Same
 * reason `board.acl.ts` and `widget.transitions.ts` are kept separate from
 * their services.
 */
export function assertWidgetPlaceable(
  board: { scope: string },
  widget: { visibility?: string },
): void {
  if (board.scope === 'TENANT' && widget.visibility === 'PRIVATE') {
    throw new AppError(MSG.WIDGET_PRIVATE_ON_SHARED, 422, ErrorCode.VALIDATION_ERROR)
  }
}
