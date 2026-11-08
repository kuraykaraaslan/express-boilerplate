import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the ROOT trusted-devices settings page (/admin/settings/trusted-devices). The key is the
// installation's: user_security.settings-policy.ts reads it from the ROOT tenant only. It can only shorten the old
// 30-day lifetime (1..30).
export const USER_SECURITY_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'trustedDeviceTtlDays',
    label: 'Trusted device lifetime (days)',
    description:
      'How long "trust this device" skips the sign-in code, 1 to 30 days, for the whole installation. Shortening it also ends devices trusted earlier once they are older than the new lifetime.',
    group: 'Trusted devices',
    type: 'number',
    defaultValue: '30',
    placeholder: '30',
    rootOnly: true,
  },
];
