import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'

/**
 * The widget status machine — pure, and deliberately free of service/db imports
 * so routes, the UI and unit tests can use it without booting env or a DataSource
 * (the same reason `dynamic_page.block.acl.ts` is kept separate from its service).
 *
 * Legal moves are DATA so the UI can ask what a widget can do next instead of
 * hardcoding the same knowledge a second time and drifting from it.
 */
export type WidgetAction = 'publish' | 'unpublish' | 'archive' | 'restore'

export const WIDGET_ACTIONS: Record<WidgetAction, { from: string[]; to: string; label: string }> = {
  publish: { from: ['DRAFT', 'PUBLISHED'], to: 'PUBLISHED', label: 'Publish' },
  unpublish: { from: ['PUBLISHED'], to: 'DRAFT', label: 'Unpublish' },
  archive: { from: ['DRAFT', 'PUBLISHED'], to: 'ARCHIVED', label: 'Archive' },
  restore: { from: ['ARCHIVED'], to: 'DRAFT', label: 'Restore' },
}

/** What this widget can do next — the UI renders its buttons from this. */
export function availableActions(status: string): Array<{ action: WidgetAction; label: string }> {
  return (Object.entries(WIDGET_ACTIONS) as Array<[WidgetAction, (typeof WIDGET_ACTIONS)[WidgetAction]]>)
    .filter(([, def]) => def.from.includes(status))
    .map(([action, def]) => ({ action, label: def.label }))
}

export function assertLegal(status: string, action: WidgetAction): void {
  if (!WIDGET_ACTIONS[action].from.includes(status)) {
    throw new AppError(MSG.INVALID_TRANSITION, 409, ErrorCode.CONFLICT)
  }
}
