/**
 * The kind `observability.series` (docs/phases/42-telemetry/04 §4.2): one entity per OTel metric series, in the `otel` lane (ED-9). Keys:
 * `value` (a gauge or sum point), and for a histogram `count`, `sum` and `bucket.<i>` (the i-th explicit bucket's count; the bounds live in
 * the series catalogue). The class follows the workspace's metrics retention (the lifecycle route's setting, capped by the plan there):
 * the smallest class that keeps at least that many days, 30 when nothing is set. Readable for series the tenant's catalogue knows; not a
 * dashboard-picker kind (the metrics explorer is this module's own surface); nobody writes it from a flow; no budget: the OTLP ingest has
 * its own rate and cardinality caps.
 */
import { RETENTION_CLASSES, type RetentionClass } from '@kuraykaraaslan-labs/telemetry/server/telemetry.contract';
import type { TelemetryEntityKind } from '@kuraykaraaslan-labs/telemetry/server/telemetry.kinds';
import { OTEL_LANE } from '@kuraykaraaslan-labs/telemetry/server/telemetry.timeseries';
import { getSeriesCatalogue, SERIES_KIND, type SeriesCatalogue } from './otel.series-catalogue';
import { TELEMETRY_SETTING_KEYS } from './telemetry.setting.keys';

export const SERIES_KEY = /^(value|count|sum|bucket\.\d{1,3})$/;
export const DEFAULT_METRICS_CLASS: RetentionClass = 30;

/** The smallest retention class that keeps at least `days`; the longest class above it; the default for nothing or nonsense. */
export function metricsRetentionClass(days: number | null | undefined): RetentionClass {
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return DEFAULT_METRICS_CLASS;
  return RETENTION_CLASSES.find((c) => c >= days) ?? RETENTION_CLASSES[RETENTION_CLASSES.length - 1]!;
}

/** The metrics retention the workspace asked for (`telemetry.lifecycle.ts` stores it), or null. */
export async function storedMetricsRetentionDays(tenantId: string): Promise<number | null> {
  try {
    // loaded when asked: the backend configuration imports this file and must not open the database at import time
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    const raw = await SettingService.getValue(tenantId, TELEMETRY_SETTING_KEYS.RETENTION);
    const doc = raw ? (JSON.parse(raw) as { days?: { metrics?: number } }) : null;
    return typeof doc?.days?.metrics === 'number' ? doc.days.metrics : null;
  } catch {
    return null;
  }
}

export function createSeriesKind(catalogue: () => SeriesCatalogue = getSeriesCatalogue, retentionDays: (tenantId: string) => Promise<number | null> = storedMetricsRetentionDays): TelemetryEntityKind {
  return {
    kind: SERIES_KIND,
    label: 'Metric series',
    keys: { mode: 'open', checkKey: (key) => (SERIES_KEY.test(key) ? null : 'key_invalid') },
    retention: { resolveClass: async (tenantId) => metricsRetentionClass(await retentionDays(tenantId)) },
    canRead: (ctx, entityIds) => catalogue().exists(ctx.tenantId, entityIds),
    exposeToDashboards: false,
    acceptsExternalWrites: false,
    lane: OTEL_LANE,
    budgetRowsPerSecond: null,
  };
}

const kind = createSeriesKind();
export default kind;
