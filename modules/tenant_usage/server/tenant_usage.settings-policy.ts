/**
 * The tenant_usage settings (Usage → Settings; keys in tenant_usage.setting.keys.ts). Unset keeps the earlier behaviour.
 *
 * - `usageAlertThresholds`: a comma-separated list of whole percentages (1..99, at most 5, e.g. "50, 80, 95") of a plan
 *   quota at which the usage job fires a `usage.threshold` webhook, once per month and threshold. Was the constant
 *   80, 95. Duplicates are dropped and the list is sorted; a list with any value that is not such a percentage, an empty
 *   list, or a failed read is the default. The `usage.overage` webhook (used above the limit) is not affected: it always fires.
 */

export const DEFAULT_USAGE_ALERT_THRESHOLDS: readonly number[] = [80, 95];
const MAX_THRESHOLDS = 5;

export function sanitizeUsageAlertThresholds(raw: string | null | undefined): number[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [...DEFAULT_USAGE_ALERT_THRESHOLDS];
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || !parts.every((p) => /^\d{1,2}$/.test(p))) return [...DEFAULT_USAGE_ALERT_THRESHOLDS];
  const values = [...new Set(parts.map((p) => Number.parseInt(p, 10)))].sort((a, b) => a - b);
  if (values.length > MAX_THRESHOLDS || values.some((v) => v < 1 || v > 99)) return [...DEFAULT_USAGE_ALERT_THRESHOLDS];
  return values;
}

export interface TenantUsagePolicy {
  alertThresholds: number[];
}

export async function getTenantUsagePolicy(tenantId: string): Promise<TenantUsagePolicy> {
  // A settings read that fails in any way falls back to the earlier behaviour. Imported on use: the usage job and its
  // tests load this file without the settings service.
  let s: Record<string, string | null> = {};
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    s = await SettingService.getByKeys(tenantId, ['usageAlertThresholds']);
  } catch { /* defaults */ }
  return { alertThresholds: sanitizeUsageAlertThresholds(s?.usageAlertThresholds) };
}
