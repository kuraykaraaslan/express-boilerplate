import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { OBSERVABILITY_LIMIT_KEYS as K, typeLimitKey } from './observability.limit-keys'
import { refusalDetails, refusalForLimit } from './observability.refusals'

/**
 * What a tenant's plan lets it do in observability (docs/phases/09-observability/16, task 16.1).
 *
 * Every limit is a `feature_gate` LIMIT whose NUMBER comes from the tenant's plan; this module only asks and enforces. Three rules:
 *  - **An undeclared key is unlimited.** Observability existed before plans limited it, so a plan that says nothing changes nothing; a plan
 *    opts in by declaring the key. (No built-in "free baseline": a deployment without plans must not start refusing monitors it used to accept.)
 *  - **Fail OPEN.** If the gate cannot answer (not installed, Redis or the billing rail down), the answer is "unlimited". Monitoring a customer's
 *    outage must not stop because the billing rail has one.
 *  - **Say what and how much.** A refusal is a 403 whose `details` name the key, the limit and the current use, so a screen can say "10 of 10".
 *
 * `0` is a meaningful limit: "this is not part of the plan" (a check type, SLOs, ...).
 */

type Resolve = (tenantId: string, key: string) => Promise<number>

/**
 * How long the gate may take. The application's Redis clients retry forever while Redis is down (BullMQ requires it), so a gate that reads its
 * cache from Redis does not fail then, it WAITS: without a bound "fail open" never happens and every alert, including the on-call self-test's
 * own failure alert, waits behind it. Found by breaking Redis under `on_call.selftest-chain.live.security.test.ts`.
 */
export const GATE_TIMEOUT_MS = 3_000

/** observability.09: the most monitors one tenant holds when its plan states no finite number. */
export const PLATFORM_MAX_MONITORS_PER_TENANT = 500

const defaultResolve: Resolve = async (tenantId, key) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      import('@kuraykaraaslan-labs/feature_gate/server/feature_gate.headroom').then(({ resolveLimit }) => resolveLimit(tenantId, key, { onGateError: 'open' })),
      new Promise<number>((resolve) => { timer = setTimeout(() => resolve(Number.POSITIVE_INFINITY), GATE_TIMEOUT_MS) }),
    ])
  } catch {
    return Number.POSITIVE_INFINITY
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let resolve: Resolve = defaultResolve

/** Test seam: replace how a limit is resolved (pass nothing to restore). */
export function setLimitResolver(fn?: Resolve): void { resolve = fn ?? defaultResolve }

/** The plan's number for `key`, `Infinity` when unlimited or unknown. */
export function limitOf(tenantId: string, key: string): Promise<number> { return resolve(tenantId, key) }

/** A refusal by plan limit: a 403 whose `details` carry the stable `code` and the dictionary `messageKey` next to the key, the limit and the use. */
export function refuse(message: string, details: Record<string, unknown> & { key: string }): never {
  throw new AppError(message, 403, ErrorCode.FORBIDDEN, { details: { ...details, ...refusalDetails(refusalForLimit(details.key)) } })
}

export interface MonitorLimitInput { type: string; intervalSeconds?: number | null; stepsCount?: number | null }

/**
 * Is this monitor allowed on the tenant's plan? Checks the check type, the shortest interval, the step count and (when `adding` is given) the
 * number of monitors (an unlimited plan is bounded by PLATFORM_MAX_MONITORS_PER_TENANT, so the count query always runs when adding).
 */
export async function assertMonitorAllowed(
  tenantId: string, input: MonitorLimitInput, opts: { adding?: number; count?: () => Promise<number> } = {},
): Promise<void> {
  const typeKey = typeLimitKey(input.type)
  if (typeKey && (await limitOf(tenantId, typeKey)) === 0) {
    refuse(`The ${input.type} monitor type is not part of your plan.`, { key: typeKey, limit: 0 })
  }
  if (input.intervalSeconds != null) {
    const min = await limitOf(tenantId, K.MIN_INTERVAL_SECONDS)
    if (Number.isFinite(min) && input.intervalSeconds < min) {
      refuse(`Your plan checks at most every ${min} seconds.`, { key: K.MIN_INTERVAL_SECONDS, limit: min, requested: input.intervalSeconds })
    }
  }
  if (input.stepsCount != null) {
    const max = await limitOf(tenantId, K.STEPS_PER_MONITOR)
    if (Number.isFinite(max) && input.stepsCount > max) {
      refuse(`Your plan allows ${max} steps per check.`, { key: K.STEPS_PER_MONITOR, limit: max, requested: input.stepsCount })
    }
  }
  if (opts.adding && opts.count) {
    // observability.09: "unlimited" (no plan, an unlimited plan, an unreadable gate) is still bounded by the platform ceiling,
    // so one tenant cannot fill the shared sweep; a finite plan number is honoured as sold, above the ceiling too.
    const planMax = await limitOf(tenantId, K.MONITORS)
    const max = Number.isFinite(planMax) ? planMax : PLATFORM_MAX_MONITORS_PER_TENANT
    if (Number.isFinite(max)) {
      const current = await opts.count()
      if (current + opts.adding > max) refuse(`Your plan allows ${max} monitors.`, { key: K.MONITORS, limit: max, current, adding: opts.adding })
    }
  }
}

/** Generic "adding N more would exceed the plan" for a counted resource. */
export async function assertHeadroomFor(
  tenantId: string, key: string, label: string, count: () => Promise<number>, adding = 1,
): Promise<void> {
  const max = await limitOf(tenantId, key)
  if (!Number.isFinite(max)) return
  const current = await count()
  if (current + adding > max) refuse(`Your plan allows ${max} ${label}.`, { key, limit: max, current, adding })
}

/** Raw-check retention: the tenant's own setting, capped by the plan. `settingDays` is already clamped by the caller. */
export function capRetention(settingDays: number, planLimit: number): number {
  return Number.isFinite(planLimit) ? Math.max(1, Math.min(settingDays, Math.floor(planLimit))) : settingDays
}

export async function retentionDaysFor(tenantId: string, settingDays: number): Promise<number> {
  return capRetention(settingDays, await limitOf(tenantId, K.CHECK_RETENTION_DAYS))
}
