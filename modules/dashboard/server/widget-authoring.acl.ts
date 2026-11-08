import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'

export type WidgetVisibility = 'TENANT' | 'PRIVATE'

/**
 * Faz 9, K11: authoring a widget needs a permission chosen by ITS OWN
 * visibility, not one flat permission — a person's own private widget needs
 * no admin blessing, and a shared one always does.
 *
 * Mirrors `board.acl.ts`'s `canWrite`/`assertCanWrite` shape on purpose: a
 * route's ENTRY gate is `dashboard.widgets.author_private` (every USER may
 * create or edit their own `PRIVATE` widget), so `hasAuthor` is the one thing
 * still worth asking `grantedPermissions` about — whether THIS caller may
 * ALSO touch a `TENANT` one. `targetVisibility` only differs from
 * `currentVisibility` on an UPDATE that also changes `visibility` (CREATE and
 * DELETE pass the same value for both). Touching a widget that IS or WOULD
 * BECOME `TENANT` always needs `hasAuthor` — without that half, a caller
 * holding only `author_private` could turn their own private widget into a
 * shared one (an escalation) or edit an existing shared widget outright by
 * first "claiming" it back to PRIVATE.
 */
export function canAuthor(
  currentVisibility: WidgetVisibility,
  targetVisibility: WidgetVisibility | undefined,
  hasAuthor: boolean,
): boolean {
  const touchesTenant = currentVisibility === 'TENANT' || (targetVisibility ?? currentVisibility) === 'TENANT'
  return !touchesTenant || hasAuthor
}

/** Throws unless the caller may create/edit at this visibility. */
export function assertCanAuthor(
  currentVisibility: WidgetVisibility,
  targetVisibility: WidgetVisibility | undefined,
  hasAuthor: boolean,
): void {
  if (!canAuthor(currentVisibility, targetVisibility, hasAuthor)) {
    throw new AppError(MSG.WIDGET_AUTHOR_PERMISSION_REQUIRED, 403, ErrorCode.FORBIDDEN)
  }
}

/**
 * The `…/transition` route's own split (K11) — unlike author/edit, the two
 * halves are `author_private` and `publish`: a shared widget's whole state
 * machine, publishing included, has always needed `dashboard.widgets.publish`
 * rather than `author`, and nothing here changes that half. Same entry-gate
 * shape as `canAuthor` above: `author_private` covers the `PRIVATE` branch by
 * being the route's entry gate, so only `hasPublish` needs asking about.
 */
export function canTransition(visibility: WidgetVisibility, hasPublish: boolean): boolean {
  return visibility === 'PRIVATE' || hasPublish
}

/** Throws unless the caller may run this transition. */
export function assertCanTransition(visibility: WidgetVisibility, hasPublish: boolean): void {
  if (!canTransition(visibility, hasPublish)) {
    throw new AppError(MSG.WIDGET_AUTHOR_PERMISSION_REQUIRED, 403, ErrorCode.FORBIDDEN)
  }
}
