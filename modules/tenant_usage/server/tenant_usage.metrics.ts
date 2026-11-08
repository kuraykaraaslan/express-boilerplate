import { z } from 'zod';
import Logger from '@kuraykaraaslan-labs/logger';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';

/**
 * Declared period metrics (docs/phases/31-feature-gate/02).
 *
 * `TenantUsageMetric` used to be a closed six-member union with one column per
 * metric in `tenant_usage`: a new monthly quota meant an entity column, a
 * migration and a union edit in a platform module. A module now DECLARES its
 * metric instead — through the `tenant_usage:metric` point — and increments it
 * by key. The six original metrics are declared here, by `tenant_usage`
 * itself, under the same keys (so every Redis key and legacy column is unchanged).
 *
 * The declaration travels in the contribution's static `metadata` (no code is
 * loaded on the hot path):
 *
 * ```json
 * { "point": "tenant_usage:metric", "key": "widgetRenders",
 *   "export": "widgets/server/widgets.usage-metric",
 *   "metadata": { "label": "Widget renders", "unit": "renders", "period": "month",
 *                 "quotaKey": "max_widget_renders_monthly" } }
 * ```
 *
 * The contribution's default export documents the same object for typed
 * consumers; only the metadata is read here.
 */

export const TENANT_USAGE_METRIC_POINT = 'tenant_usage:metric';

export const MetricDeclarationSchema = z.object({
  /** Redis / table key: lowerCamel, stable forever. */
  key: z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/),
  label: z.string().min(1).max(120),
  unit: z.string().min(1).max(32),
  /** `month` counters reset each calendar month; `day` counters each UTC day. */
  period: z.enum(['month', 'day']),
  /** `feature_gate` LIMIT key this metric is enforced against, when it has a quota. */
  quotaKey: z.string().min(1).max(100).optional(),
});
export type MetricDeclaration = z.infer<typeof MetricDeclarationSchema>;

/** The six original metrics. Same keys as the legacy `TenantUsageMetric` union and `tenant_usage` columns. */
export const BUILTIN_METRICS: readonly MetricDeclaration[] = [
  { key: 'apiCalls', label: 'API calls', unit: 'calls', period: 'month' },
  { key: 'aiTokens', label: 'AI tokens', unit: 'tokens', period: 'month', quotaKey: FEATURE_KEYS.FEATURE_AI_MONTHLY_TOKENS },
  { key: 'storageBytes', label: 'Storage', unit: 'bytes', period: 'month', quotaKey: FEATURE_KEYS.FEATURE_STORAGE_QUOTA_BYTES },
  { key: 'emailSends', label: 'Emails sent', unit: 'emails', period: 'month', quotaKey: FEATURE_KEYS.FEATURE_EMAIL_MONTHLY_QUOTA },
  { key: 'smsSends', label: 'SMS sent', unit: 'messages', period: 'month', quotaKey: FEATURE_KEYS.FEATURE_SMS_MONTHLY_QUOTA },
  { key: 'webhookCalls', label: 'Webhook calls', unit: 'calls', period: 'month' },
];

/** Keys backed by a dedicated legacy column on `tenant_usage` (kept for one release). */
export const LEGACY_METRIC_KEYS: readonly string[] = BUILTIN_METRICS.map((m) => m.key);

let cache: Promise<Map<string, MetricDeclaration>> | null = null;
const warnedUnknown = new Set<string>();

/** A process-wide catalog (a system context): the metrics this build declares, whatever any tenant has switched on. */
async function build(): Promise<Map<string, MetricDeclaration>> {
  const map = new Map<string, MetricDeclaration>();
  for (const m of BUILTIN_METRICS) map.set(m.key, m);
  for (const c of await ext.contributions(TENANT_USAGE_METRIC_POINT, systemCtx('process-wide usage metric catalog'))) {
    const parsed = MetricDeclarationSchema.safeParse({ ...c.metadata, key: c.key });
    if (!parsed.success) {
      Logger.warn(`[tenant_usage] ignoring malformed metric declaration from '${c.moduleId}': ${parsed.error.issues[0]?.message}`);
      continue;
    }
    if (map.has(parsed.data.key)) {
      // A contribution may never redefine a declared key (legacy keys especially).
      Logger.warn(`[tenant_usage] metric '${parsed.data.key}' from '${c.moduleId}' collides with an existing declaration; ignored`);
      continue;
    }
    map.set(parsed.data.key, parsed.data);
  }
  return map;
}

/** Every declared metric, resolved once per process (a failed read is retried on the next call). */
export function getDeclaredMetrics(): Promise<Map<string, MetricDeclaration>> {
  cache ??= build().catch((error: unknown) => { cache = null; throw error; });
  return cache;
}

export async function getMetricDeclaration(key: string): Promise<MetricDeclaration | undefined> {
  return (await getDeclaredMetrics()).get(key);
}

/**
 * Hot-path guard: is `key` declared? An unknown key is logged (once per key per
 * process) and the caller drops the increment — never thrown on a hot path. After
 * the first call the catalog is an already-settled promise.
 */
export async function isDeclaredMetric(key: string): Promise<boolean> {
  if ((await getDeclaredMetrics()).has(key)) return true;
  if (!warnedUnknown.has(key)) {
    warnedUnknown.add(key);
    Logger.warn(`[tenant_usage] increment for undeclared metric '${key}' dropped (declare it via '${TENANT_USAGE_METRIC_POINT}')`);
  }
  return false;
}

/** Test seam: replace (or clear, with `null`) the per-process declaration cache. */
export function __setDeclaredMetricsForTests(extra: MetricDeclaration[] | null): void {
  warnedUnknown.clear();
  if (extra === null) { cache = null; return; }
  cache = Promise.resolve(new Map([...BUILTIN_METRICS, ...extra].map((m) => [m.key, m])));
}
