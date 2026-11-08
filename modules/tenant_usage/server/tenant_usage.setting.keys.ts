import { z } from 'zod';

/**
 * Per-tenant setting keys of tenant_usage (Usage → Settings, `/admin/usage/settings`). Read by
 * tenant_usage.settings-policy.ts for the quota alerts of the usage job (tenant_usage.alerts.service.ts).
 *
 * - `usageAlertThresholds`: the percentages of a plan quota at which a `usage.threshold` webhook fires, once a month
 *   each (was the constant 80, 95).
 */
export const TenantUsageSettingKeySchema = z.enum([
  'usageAlertThresholds',
]);
export type TenantUsageSettingKey = z.infer<typeof TenantUsageSettingKeySchema>;
export const TENANT_USAGE_KEYS = TenantUsageSettingKeySchema.options;
