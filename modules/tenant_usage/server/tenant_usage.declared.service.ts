import { getDeclaredMetrics } from './tenant_usage.metrics';
import { getMetricUsage } from './tenant_usage.read.service';
import { checkMetricQuota } from './tenant_usage.quota';

export interface DeclaredUsageRow {
  key: string;
  label: string;
  unit: string;
  period: 'month' | 'day';
  value: number;
  /** Plan quota; `null` when the metric declares none, `-1` when unlimited. */
  quota: number | null;
  percent: number | null;
  inGrace: boolean;
}

/**
 * Every declared metric with its current value and plan quota — the generic feed
 * for the tenant's usage screen (label, unit, value, quota) so a new metric shows
 * up without a UI change. A quota that cannot be read shows as unlimited rather
 * than failing the whole screen.
 */
export async function listDeclaredUsage(tenantId: string): Promise<DeclaredUsageRow[]> {
  return Promise.all([...(await getDeclaredMetrics()).values()].map(async (d): Promise<DeclaredUsageRow> => {
    const value = await getMetricUsage(tenantId, d.key).catch(() => 0);
    if (!d.quotaKey) {
      return { key: d.key, label: d.label, unit: d.unit, period: d.period, value, quota: null, percent: null, inGrace: false };
    }
    const q = await checkMetricQuota(tenantId, d.key, { onGateError: 'open' });
    const unlimited = q.limit === Infinity;
    return {
      key: d.key, label: d.label, unit: d.unit, period: d.period, value,
      quota: unlimited ? -1 : q.limit,
      percent: unlimited || q.limit <= 0 ? null : Math.round((value / q.limit) * 100),
      inGrace: q.inGrace,
    };
  }));
}
