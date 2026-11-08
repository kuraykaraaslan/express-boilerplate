import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Settings → In-app Notifications (/admin/settings/in-app-notifications). The key is read by
// notification_inapp.helpers.ts resolveRetentionTtl on every new item and every read mark. Default: 7 days, as before.
export const NOTIFICATION_INAPP_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'inAppRetentionDays',
    label: 'Keep the notification feed (days)',
    description: 'A member\'s feed in the top bar is kept this many days after its last new item, then cleared. 1 to 365. The newest 50 items are kept either way.',
    group: 'Feed',
    type: 'number',
    defaultValue: '7',
    placeholder: '7',
  },
];
