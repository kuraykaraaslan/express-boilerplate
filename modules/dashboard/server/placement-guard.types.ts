import { AppError } from '@kuraykaraaslan-labs/common/server/app-error'

/**
 * The `dashboard:placement_guard` seam (docs/phases/07-dashboard/31, contract C4).
 *
 * A module that limits what a placement of a builtin widget kind may HOLD for a tenant (options it sells one by one, for example)
 * contributes a guard; `metadata.types` lists the builtin kind types it guards. The dashboard asks the guards of a placement's kind
 * on every write that stores the kind's settings, after the settings passed the kind's template validation:
 *
 *   - a placement create and update, a template apply and a board import (`createMany`), the cards a board is laid out with
 *     (`materialize`);
 *   - a board copy: every copied card is a new placement;
 *   - a preset ("Save as widget"): its create, an edit of its defaults, and its publish.
 *
 * The guard gets `{ tenantId, widgetType, settings, previous }`: the kind's EFFECTIVE settings the placement will draw (the
 * template's defaults, then a preset's own defaults, then the stored object, after the template's upgrades) and the ones it drew
 * before (`previous`; null when nothing is stored to compare with: a new placement, a copy, a new preset, a first publish). It
 * judges the change, not the whole object: a value that was already stored is not new.
 *
 * A guard REFUSES by throwing an AppError below 500. The dashboard answers 422 with `details.reason` = `placement_guard_refused`
 * (the guard's own details kept, its own `reason` moved to `details.guardReason`), which a board copy rethrows instead of copying
 * the card as stored (its other 422s keep doing that) and an import rethrows as every refusal. Anything else a guard throws, a
 * guard that cannot be loaded, or one that does not answer in time is a 503 (`placement_guard_unavailable`): nothing is stored,
 * the guards fail closed. Only the contributions of modules active for the tenant run, and a type no contribution lists costs
 * nothing (no code is loaded, no state is read).
 */

export const PLACEMENT_GUARD_POINT = 'dashboard:placement_guard'

/** What a guard is asked about. Both objects are copies: a guard cannot change what is stored. */
export interface PlacementGuardInput {
  tenantId: string
  /** The builtin kind type of the placement (a type the contribution lists in `metadata.types`). */
  widgetType: string
  /** The kind's effective settings the placement will draw. */
  settings: Record<string, unknown>
  /** The kind's effective settings it drew before; null when nothing is stored to compare with. */
  previous: Record<string, unknown> | null
}

/** What a `dashboard:placement_guard` contribution default-exports: resolves to allow, throws an AppError below 500 to refuse. */
export type PlacementGuard = (input: PlacementGuardInput) => Promise<void> | void

/** `details.reason` of a guard's refusal (422): the code a board copy and an import rethrow. */
export const PLACEMENT_GUARD_REFUSED = 'placement_guard_refused'

/** `details.reason` of the 503 a guard that could not answer gives. */
export const PLACEMENT_GUARD_UNAVAILABLE = 'placement_guard_unavailable'

/**
 * The API's words for the 503. Not in `dashboard.messages.ts`: the guards' own refusal carries the words a viewer reads, and this
 * one is the platform's "try again".
 */
export const PLACEMENT_GUARD_UNAVAILABLE_MESSAGE = 'The placement could not be checked; try again'

/** Whether an error is a guard's refusal as the dashboard rethrows it (422, `placement_guard_refused`). */
export function isPlacementGuardRefusal(err: unknown): err is AppError {
  return err instanceof AppError && err.statusCode === 422 && err.details?.reason === PLACEMENT_GUARD_REFUSED
}
