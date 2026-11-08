import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Usage → Settings (/admin/usage/settings). Keys in tenant_usage.setting.keys.ts, checked by
// tenant_usage.settings-policy.ts.
export const TENANT_USAGE_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'usageAlertThresholds',
    label: 'Quota alert thresholds (%)',
    description: 'Comma-separated percentages of a plan quota (1 to 99, at most 5) at which a usage threshold webhook is sent, once a month each. Going over the quota always sends an overage webhook.',
    group: 'Quota alerts',
    type: 'text',
    defaultValue: '80, 95',
    placeholder: '80, 95',
  },
];
