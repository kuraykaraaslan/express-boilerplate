import Logger from '@kuraykaraaslan-labs/logger';
import type { TelemetryEntityKind } from '@kuraykaraaslan-labs/telemetry/server/telemetry.kinds';
import { readerMeetsPermission } from '@kuraykaraaslan-labs/telemetry/server/telemetry.permissions';
import { MinuteProjection } from '@kuraykaraaslan-labs/telemetry/server/telemetry.projection';
import { getTelemetryQueryService, type SeriesBucket, type TelemetryPoint } from '@kuraykaraaslan-labs/telemetry/server/telemetry.query.service';
import { getTelemetryWriter } from '@kuraykaraaslan-labs/telemetry/server/telemetry.writer';

/**
 * The usage counters projected onto the Core telemetry store (docs/phases/42-telemetry/06): the Redis counters and the
 * `tenant_usage_metrics` table stay the quota source (`assertPeriodQuota` needs an exact, transactional count); the store carries the
 * hourly and daily curves the usage page shows beside the period totals.
 *
 * Kind `tenant_usage`: entity = the tenant; keys = the declared metric keys (the declaration's alphabet; `increment` already drops an
 * undeclared key before this is reached); class 365; readable for the tenant's own entity with `tenant_usage.metrics.read`; shown to
 * dashboards. Projection (00 §0.3): every increment folds into the minute window of its time, one row per window and metric with the
 * window's end as `ts` (`MinuteProjection`); the store carries deltas, so a series summed over a period equals the counter's total.
 */
export const TENANT_USAGE_KIND = 'tenant_usage';
export const METRIC_KEY = /^[a-z][A-Za-z0-9]{0,63}$/;

export const tenantUsageKind: TelemetryEntityKind = {
  kind: TENANT_USAGE_KIND,
  label: 'Workspace usage',
  keys: { mode: 'open', checkKey: (key) => (METRIC_KEY.test(key) ? null : 'key_invalid') },
  retention: { fixedClass: 365 },
  // the tenant's own counters only, for a reader at the permission's floor
  canRead: async (ctx, entityIds) => {
    const own = entityIds.map((e) => e.toLowerCase()).filter((e) => e === ctx.tenantId.toLowerCase());
    return own.length && (await readerMeetsPermission(ctx, 'tenant_usage.metrics.read')) ? new Set(own) : new Set();
  },
  exposeToDashboards: true,
  acceptsExternalWrites: false,
  budgetRowsPerSecond: 2_000,
};

export default tenantUsageKind;

let projection: MinuteProjection | null = null;
/** The process's projection buffer. */
export function usageProjection(): MinuteProjection {
  projection ??= new MinuteProjection({ kind: TENANT_USAGE_KIND, writer: () => getTelemetryWriter(), warn: (t) => Logger.warn(`[tenant_usage] usage projection: ${t}`) });
  return projection;
}
/** Tests: a buffer of their own (`undefined` goes back to the process one). */
export function setUsageProjectionForTests(p: MinuteProjection | undefined): void { projection = p ?? null; }

/** Called by `increment` after the counter moved; never awaited, never throws. */
export function projectIncrement(tenantId: string, metric: string, delta: number, at: number = Date.now()): void {
  try {
    usageProjection().add(tenantId, tenantId.toLowerCase(), metric, delta, at, 'sum');
  } catch (err) {
    Logger.warn(`[tenant_usage] increment not projected for ${metric}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The curve of one declared metric over a window, from the store (deltas summed per bucket). */
export async function usageSeries(tenantId: string, metric: string, o: { from: number; to: number; bucket?: SeriesBucket }): Promise<{ bucket: Exclude<SeriesBucket, 'auto'>; points: TelemetryPoint[] }> {
  const svc = getTelemetryQueryService();
  const series = await svc.series(tenantId, TENANT_USAGE_KIND, tenantId.toLowerCase(), [metric], { from: o.from, to: o.to, bucket: o.bucket, agg: 'sum' });
  return { bucket: o.bucket && o.bucket !== 'auto' ? o.bucket : svc.resolutionFor(o.from, o.to), points: series[metric] ?? [] };
}
