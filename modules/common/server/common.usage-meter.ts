import { ext, tenantCtx } from './extensions/ext'
import { commonUsageMeterLoaders } from './generated/extensions/common.usage_meter'

/**
 * Where a lower-edition module records metered usage. `observability` (uptime probes, alerts, telemetry bytes) and `on_call` (pages, SMS segments,
 * voice minutes) meter their own use, but `metering` is an Enterprise module and a Core module may not import a higher edition (ADR-0001, phase 35/02).
 * `metering` contributes the sink (`metering/server/metering.usage-meter`); a workspace without it, or with it switched off for the tenant, records
 * nothing, which is what both callers did before when they asked `ifActive(tenantId, 'metering', ...)`.
 *
 * Hosted by `common`, not by one of the two callers: `metering` then contributes once for both, and neither caller becomes a contribution target of
 * a module it already sits below. Declared in common/module.json `extensionPoints`.
 */
export const USAGE_METER_POINT = 'common:usage_meter'

/** A meter as the caller defines it. Created on first use at price 0 with no allowance: usage becomes visible and limitable, pricing is the operator's. */
export interface UsageMeterDefinition { key: string; name: string; unit: string }

/** One usage event. `quantity` is rounded to a whole unit of at least one; `idempotencyKey` (kept to 128 characters) makes a replay a no-op. */
export interface UsageMeterEvent {
  meterKey: string
  quantity: number
  idempotencyKey?: string
  /** Small, scalar and bounded (the caller cleans it). */
  metadata?: Record<string, string>
}

export interface UsageMeterSink {
  /** Create the tenant's meter on first use (a no-op when it exists). */
  ensureMeter(tenantId: string, meter: UsageMeterDefinition): Promise<void>
  record(tenantId: string, event: UsageMeterEvent): Promise<void>
}

/** The tenant's contributed sink, or `null` when no module active for the tenant provides one. */
export async function loadUsageMeterSink(tenantId: string): Promise<UsageMeterSink | null> {
  const found = await ext.first<UsageMeterSink, UsageMeterSink>(
    USAGE_METER_POINT, tenantCtx(tenantId), commonUsageMeterLoaders, (sink) => sink,
  )
  return found?.value ?? null
}

/** Loads the contributed sink's code without calling it (a sidecar warms what its first record would otherwise load lazily). */
export async function warmUsageMeterSink(): Promise<void> {
  await Promise.allSettled(Object.values(commonUsageMeterLoaders.loaders).map((load) => load()))
}
