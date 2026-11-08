import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ext, systemCtx, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardPlacementGuardLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.placement_guard'
import type { BuiltinKindSpec } from '@kuraykaraaslan-labs/common/server/widget-settings/kind'
import { resolvePlacement } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/resolve'
import {
  PLACEMENT_GUARD_POINT, PLACEMENT_GUARD_REFUSED, PLACEMENT_GUARD_UNAVAILABLE, PLACEMENT_GUARD_UNAVAILABLE_MESSAGE,
  type PlacementGuard, type PlacementGuardInput,
} from './placement-guard.types'

export { PLACEMENT_GUARD_POINT, isPlacementGuardRefusal } from './placement-guard.types'

/**
 * The host of `dashboard:placement_guard` (docs/phases/07-dashboard/31, contract C4; the seam is described in
 * `placement-guard.types.ts`). The dashboard never names a contributor or what it guards: it hands the guards of a placement's
 * kind the settings before and after a write, and stores nothing a guard refused or could not judge.
 */

const MALFORMED = 'the contribution is not a function'

/** The builtin kind types a contribution guards (`metadata.types`). */
function typesOf(contribution: { metadata?: Record<string, unknown> | null }): string[] {
  const types = contribution.metadata?.types
  return Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : []
}

/** Every contribution, active or not, from the static records: no code is loaded and no tenant state is read. */
const declared = () => ext.contributions(PLACEMENT_GUARD_POINT, systemCtx('the widget types a placement guard lists (static records only)'))

/** Whether anything contributes to the point at all. */
export const hasPlacementGuards = async (): Promise<boolean> => (await declared()).length > 0

/** Whether a contribution, active or not, lists this kind type: only then is anything loaded or asked for it. */
export async function isGuardedType(widgetType: string): Promise<boolean> {
  return (await declared()).some((c) => typesOf(c).includes(widgetType))
}

/**
 * A kind's own settings as a placement draws them: the template's defaults, then a preset's defaults (`definitionDefaults`), then
 * the stored object, after the template's upgrades (a renamed value reads as the kept one). What the guards are given.
 */
export function effectiveKindSettings(
  kind: BuiltinKindSpec,
  settings: Record<string, unknown> | null | undefined,
  definitionDefaults?: Record<string, unknown> | null,
): Record<string, unknown> {
  return resolvePlacement({
    template: kind.template, slotCount: kind.slots.length, settings: settings ?? null, definitionDefaults: definitionDefaults ?? null,
  }).settings as Record<string, unknown>
}

const unavailable = (): AppError =>
  new AppError(PLACEMENT_GUARD_UNAVAILABLE_MESSAGE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true, details: { reason: PLACEMENT_GUARD_UNAVAILABLE } })

/** A guard's own refusal as the dashboard answers it: 422, `details.reason` = `placement_guard_refused`, the guard's details kept. */
function refusalOf(err: AppError, widgetType: string, moduleId: string): AppError {
  const { reason: guardReason, ...details } = err.details ?? {}
  return new AppError(err.message, 422, err.code, {
    details: { ...details, reason: PLACEMENT_GUARD_REFUSED, ...(guardReason !== undefined ? { guardReason } : {}), widgetType, guard: moduleId },
  })
}

/** A deep copy, so a guard never holds the object that is stored. */
const copy = <T>(v: T): T => (v === null || v === undefined ? v : structuredClone(v))

/**
 * Asks the guards of `input.widgetType` about a write, in order; the first refusal stops the rest and is thrown (422
 * `placement_guard_refused`). A guard that throws anything else, cannot be loaded or does not answer in time makes the write
 * a 503 (`placement_guard_unavailable`), and so does a contributor state that cannot be read. A type no contribution lists
 * returns at once.
 */
export async function assertPlacementGuards(input: PlacementGuardInput): Promise<void> {
  if (!(await isGuardedType(input.widgetType))) return
  let objected = false
  let objection: { refusal: AppError; moduleId: string } | null | undefined
  let blocked: boolean
  try {
    const outcome = await ext.guard<PlacementGuard, { refusal: AppError; moduleId: string } | null>(
      PLACEMENT_GUARD_POINT, tenantCtx(input.tenantId), dashboardPlacementGuardLoaders,
      async (guard, _signal, contribution) => {
        // Every active contribution is loaded; only the guards of this type are asked.
        if (!typesOf(contribution).includes(input.widgetType)) return null
        if (typeof guard !== 'function') throw new Error(MALFORMED)
        if (objected) return null
        try {
          await guard({ tenantId: input.tenantId, widgetType: input.widgetType, settings: copy(input.settings), previous: copy(input.previous) })
          return null
        } catch (err) {
          // An answer: carried as a value so the runtime does not count the guard as broken. Anything else is not an answer.
          if (!(err instanceof AppError) || err.statusCode >= 500) throw err
          objected = true
          return { refusal: err, moduleId: contribution.moduleId }
        }
      },
      { sequential: true },
    )
    objection = outcome.results.find((r) => r.value)?.value
    blocked = outcome.blocked
  } catch {
    // The contributor states or the registry could not be read: nothing can say the write is allowed.
    throw unavailable()
  }
  if (objection) throw refusalOf(objection.refusal, input.widgetType, objection.moduleId)
  if (blocked) throw unavailable()
}
