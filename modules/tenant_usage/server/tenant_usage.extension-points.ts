import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { tenantUsageQuotaAlertLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/tenant_usage.quota_alert';

/**
 * `tenant_usage:quota_alert` (docs/phases/53-setting-levels 53.9, D173): a tenant's use of a metered quota passed one of its
 * alert thresholds this month, used it up, or went over it. tenant_usage already sends the `usage.threshold` / `usage.overage`
 * webhooks; a listener does what the tenant's people see (tenant_subscription tells its owners and points them to the usage
 * packs). Fired at most once per metric, kind and threshold a month, from the periodic usage job.
 */
export const TENANT_USAGE_QUOTA_ALERT_POINT = 'tenant_usage:quota_alert';

export interface QuotaAlert {
  tenantId: string;
  /** The metric (`aiTokens`, `emailSends`…) and its label (`AI tokens`). */
  metric: string;
  label: string;
  /** The metric's unit (`tokens`, `emails`, `messages`, `bytes`…). */
  unit: string;
  /** The feature_gate LIMIT it is held to (`feature_ai_monthly_tokens`…). */
  quotaKey: string;
  used: number;
  /** This month's allowance: the plan's limit with the packs held added. */
  limit: number;
  percent: number;
  /** `threshold`: passed `threshold` %; `exhausted`: used up; `overage`: over it (inside the grace). */
  kind: 'threshold' | 'exhausted' | 'overage';
  threshold?: number;
  /** `YYYY-MM`, UTC. */
  month: string;
}

/** Default export of a `tenant_usage:quota_alert` contribution. */
export interface QuotaAlertListener {
  quotaAlert(alert: QuotaAlert): Promise<void>;
}

/** Tells every listener. Best-effort: a listener that fails is logged by the bridge and the sweep goes on. */
export async function announceQuotaAlert(alert: QuotaAlert): Promise<void> {
  await ext.fanOut<QuotaAlertListener>(
    TENANT_USAGE_QUOTA_ALERT_POINT, tenantCtx(alert.tenantId), tenantUsageQuotaAlertLoaders,
    (listener) => listener.quotaAlert(alert),
  );
}
