import type { AnyAction } from './instance-actions'

/**
 * The `dashboard:element_actions` seam (docs/phases/07-dashboard/28, task 28.1).
 *
 * The three element gestures (`elementClick`, `elementDoubleClick`, `elementContextClick`) are part of the dashboard's action
 * model: an entry on one hangs off an element id (`elementKey`) of the widget. What an ELEMENT is (a symbol of a process
 * diagram, a link in a text) is the widget's own business. A widget type that lets those gestures run a `command` contributes
 * a provider; `key` = a manifest key, `metadata.widgetType` = the widget type it serves (a key cannot hold a dot).
 *
 * The DTO checks the SHAPE of such an entry (`confirm`, params that read no row and no form field). Everything that needs to
 * know the widget goes through the provider of the placement's type:
 *
 *   - instance create / update: `allowsCommands`, then `validateEntries` against the settings the placement will hold, and
 *     `keepsEntries` when only the settings change;
 *   - the same two saves, `authoringPermission` (optional): the permission a caller needs to store a command entry that is new or
 *     changed against the placement's stored ones (403 without it; a caller that cannot be asked is refused);
 *   - the run route: `hasElement` (a stale or foreign id is the same 404 as a command that is not configured),
 *     `confirmFloor` (the confirmation the run asks for, on top of the command's own policy) and `auditFields`.
 *
 * No provider for the type, or its module off for the tenant: commands on the widget's elements are refused (422 on write,
 * 404 on run). The generic command gates (permission, rate limit, replay, audit row) never move: they stay in the dashboard.
 */

export const ELEMENT_ACTIONS_POINT = 'dashboard:element_actions'

/** A stored command entry on an element gesture, as a provider sees it. */
export interface ElementCommandEntry {
  id: string
  sourceKey: string
  /** The element the entry hangs off; always set on a stored one (the DTO refuses an element entry without it). */
  elementKey?: string
  /** The author's confirmation level; absent = the plain one. */
  confirm?: 'confirm' | 'typed'
  action: AnyAction
}

/** The confirmation a symbol gesture's command is run behind, at least. */
export type ConfirmFloor = 'confirm' | 'typed'

/** What a `dashboard:element_actions` contribution default-exports. Every method is pure (no I/O). */
export interface ElementActionsProvider {
  /**
   * The permission id a caller needs to ADD or CHANGE a command entry on this widget's elements (a manifest permission of the
   * contributing module). Absent = no extra permission: the command authoring check and the dashboard's own permissions decide.
   * Only a new or changed entry asks for it: a save that leaves the stored entries as they are, or removes some, does not.
   */
  authoringPermission?: string
  /**
   * The settings the element checks below (`validateEntries`, `keepsEntries`, `hasElement`) read, when the widget's elements are not in its own settings
   * alone: a card whose scene is a stored document (phase 42.5: its default diagram) has the document's elements. Optional; absent or returning the
   * settings as given means the checks read the placement's own settings, as before. Never throws: a document that cannot be read is the placement's own.
   */
  elementSettings?(tenantId: string, settings: unknown): Promise<unknown>
  /** May command entries be stored on this widget's elements, given the settings it will hold? false = 422. */
  allowsCommands(settings: unknown): boolean
  /** Throws an AppError (422) when an entry names an element the settings do not have. Called with at least one entry. */
  validateEntries(settings: unknown, entries: ElementCommandEntry[]): void
  /** Throws an AppError (409) when new settings remove or rename an element a stored entry still hangs off. */
  keepsEntries(settings: unknown, stored: ElementCommandEntry[]): void
  /** Does the element still exist in the settings? A run for one that does not is refused as not configured. */
  hasElement(settings: unknown, elementKey: string): boolean
  /** The confirmation this entry's command is asked behind, whatever the command's own policy says. */
  confirmFloor(entry: ElementCommandEntry): ConfirmFloor
  /** Extra fields of the audit row of a run of this entry (which element, which gesture ...). */
  auditFields(entry: ElementCommandEntry): Record<string, unknown>
}
