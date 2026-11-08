import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { TenantUsage } from './entities/tenant_usage.entity';
import { TenantUsageService, type TenantUsageSnapshot } from './tenant_usage.service';
import { getDeclaredMetrics, LEGACY_METRIC_KEYS } from './tenant_usage.metrics';
import { getMetricUsage } from './tenant_usage.read.service';
import { getTenantUsagePolicy } from './tenant_usage.settings-policy';
import { announceQuotaAlert, type QuotaAlert } from './tenant_usage.extension-points';

/**
 * Metrics that map to a per-period plan quota: every DECLARED metric with a
 * `quotaKey` (docs/phases/31-feature-gate/02) — the original four plus whatever other
 * modules declare through `tenant_usage:metric`.
 */
async function quotaMetrics(): Promise<Array<[metric: string, quotaKey: string, label: string, unit: string]>> {
  return [...(await getDeclaredMetrics()).values()].filter((d) => d.quotaKey).map((d) => [d.key, d.quotaKey as string, d.label, d.unit]);
}

/** Used units: the legacy snapshot for the six original metrics, the open reader for the rest. */
async function usedOf(tenantId: string, metric: string, snapshot: TenantUsageSnapshot): Promise<number> {
  if (LEGACY_METRIC_KEYS.includes(metric)) return snapshot[metric as keyof TenantUsageSnapshot];
  return getMetricUsage(tenantId, metric).catch(() => 0);
}


export interface OverageRow {
  metric: string;
  used: number;
  limit: number | null;
  unlimited: boolean;
  overUnits: number;
  percent: number | null;
}

export class TenantUsageAlertsService {

  /** Once-per-month-per-threshold dedup so alerts don't re-fire each sweep. */
  private static async alreadyAlerted(tenantId: string, metric: string, marker: string): Promise<boolean> {
    const month = TenantUsageService.currentMonth();
    const key = `tenant:${tenantId}:usage:alerted:${month}:${metric}:${marker}`;
    try {
      const set = await redis.set(key, '1', 'EX', 40 * 24 * 60 * 60, 'NX');
      return set === null; // null = key already existed → already alerted
    } catch {
      return false; // fail-open: better to risk a duplicate alert than miss one
    }
  }

  /**
   * Evaluate a tenant's metered usage against plan quotas and fire
   * `usage.threshold` (pre-exhaustion alerting) and `usage.overage` (billing
   * trigger) webhooks. Idempotent within a month via per-threshold dedup.
   * Designed to be called from the periodic usage job.
   */
  static async evaluateAlerts(tenantId: string): Promise<{ thresholds: number; overages: number }> {
    const usage = await TenantUsageService.getUsage(tenantId).catch(() => null);
    if (!usage) return { thresholds: 0, overages: 0 };
    let thresholds = 0, overages = 0;
    // The percentages of quota that fire usage.threshold (Usage → Settings; 80 and 95 when unset).
    const { alertThresholds } = await getTenantUsagePolicy(tenantId);

    for (const [metric, featureKey, label, unit] of await quotaMetrics()) {
      const used = await usedOf(tenantId, metric, usage);
      if (used <= 0) continue;
      const access = await FeatureGateService.checkFeatureAccess(tenantId, featureKey, used).catch(() => null);
      if (!access || access.type !== 'LIMIT' || access.unlimited || access.limit == null || access.limit <= 0) continue;

      const limit = access.limit;
      const percent = Math.round((used / limit) * 100);
      // Phase 53.9 (D173): the listeners of `tenant_usage:quota_alert` (tenant_subscription tells the owners and offers the packs).
      const announce = (kind: QuotaAlert['kind'], threshold?: number) => announceQuotaAlert({
        tenantId, metric, label, unit, quotaKey: featureKey, used, limit, percent, kind, month: TenantUsageService.currentMonth(),
        ...(threshold !== undefined ? { threshold } : {}),
      }).catch((e) => Logger.warn(`[tenant_usage] quota alert listeners failed: ${e instanceof Error ? e.message : e}`));

      // Used up (requests now stop at the limit, so this is the usual end of a month) or over it inside the grace: once
      // per month per metric each. Either supersedes the threshold alerts.
      if (used >= limit) {
        const kind = used > limit ? 'overage' : 'exhausted';
        if (await this.alreadyAlerted(tenantId, metric, kind) === false) {
          if (kind === 'overage') {
            // Overage (billing trigger).
            await WebhookService.dispatchEvent(tenantId, 'usage.overage', {
              metric, used, limit, overUnits: used - limit, month: TenantUsageService.currentMonth(),
            }).catch((e) => Logger.warn(`[tenant_usage] overage webhook failed: ${e instanceof Error ? e.message : e}`));
            overages++;
          }
          await announce(kind);
        }
        continue;
      }

      // Pre-exhaustion threshold alerts (the tenant's thresholds, 80% / 95% by default).
      for (const t of alertThresholds) {
        if (percent >= t && percent < 100 && await this.alreadyAlerted(tenantId, metric, `t${t}`) === false) {
          await WebhookService.dispatchEvent(tenantId, 'usage.threshold', {
            metric, used, limit, percent, threshold: t, month: TenantUsageService.currentMonth(),
          }).catch((e) => Logger.warn(`[tenant_usage] threshold webhook failed: ${e instanceof Error ? e.message : e}`));
          await announce('threshold', t);
          thresholds++;
        }
      }
    }
    return { thresholds, overages };
  }

  /** Per-metric overage report (used vs plan limit) for billing/operator views. */
  static async overageReport(tenantId: string): Promise<OverageRow[]> {
    const usage = await TenantUsageService.getUsage(tenantId);
    const out: OverageRow[] = [];
    for (const [metric, featureKey] of await quotaMetrics()) {
      const used = await usedOf(tenantId, metric, usage);
      const access = await FeatureGateService.checkFeatureAccess(tenantId, featureKey, used).catch(() => null);
      const limit = access?.type === 'LIMIT' ? access.limit : null;
      const unlimited = Boolean(access?.unlimited);
      out.push({
        metric, used, limit, unlimited,
        overUnits: !unlimited && limit != null && used > limit ? used - limit : 0,
        percent: !unlimited && limit && limit > 0 ? Math.round((used / limit) * 100) : null,
      });
    }
    return out;
  }

  /**
   * Platform-wide usage aggregation for an operator dashboard — summed across
   * all tenants for a month, plus the top tenants by API call volume.
   */
  static async getPlatformUsage(month?: string): Promise<{
    month: string;
    totals: TenantUsageSnapshot;
    tenantCount: number;
    topTenants: Array<{ tenantId: string; apiCalls: number; aiTokens: number; storageBytes: number }>;
  }> {
    const targetMonth = month ?? TenantUsageService.currentMonth();
    // Every tenant's row for the month — a deliberate cross-tenant read, so
    // on the SYSTEM connection rather than the default one (docs/phases/10-db Faz 3).
    const rows = await withSystemRLS((qr) => qr.manager.getRepository(TenantUsage).find({ where: { month: targetMonth } }));
    const totals: TenantUsageSnapshot = { apiCalls: 0, aiTokens: 0, storageBytes: 0, emailSends: 0, smsSends: 0, webhookCalls: 0 };
    for (const r of rows) {
      totals.apiCalls += r.apiCalls;
      totals.aiTokens += Number(r.aiTokens);
      totals.storageBytes += Number(r.storageBytes);
      totals.emailSends += r.emailSends;
      totals.smsSends += r.smsSends ?? 0;
      totals.webhookCalls += r.webhookCalls ?? 0;
    }
    const topTenants = [...rows]
      .sort((a, b) => b.apiCalls - a.apiCalls).slice(0, 20)
      .map((r) => ({ tenantId: r.tenantId, apiCalls: r.apiCalls, aiTokens: Number(r.aiTokens), storageBytes: Number(r.storageBytes) }));
    return { month: targetMonth, totals, tenantCount: rows.length, topTenants };
  }
}

export default TenantUsageAlertsService;
