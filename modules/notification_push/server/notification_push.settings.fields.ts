import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Settings → Push (/admin/settings/push). The switch is read by notification_push.config isPushEnabled
// (every send; anything but 'false' is on). The other keys are read by notification_push.settings-policy.ts: the device
// cap by the subscribe and token routes (subscription.service), the plugin key by the browser sender (send.service).
// Defaults are the earlier behaviour. The VAPID keys and their contact e-mail stay on Settings → Notifications.
export const NOTIFICATION_PUSH_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'pushEnabled',
    label: 'Push notifications',
    description: 'Send push notifications to this workspace\'s browsers and app installs. Off, no push is sent; members keep their registered devices.',
    group: 'Delivery',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: 'pushMaxSubscriptionsPerUser',
    label: 'Devices per member',
    description: 'How many browsers and app installs one member may register for push. A new device past the limit is refused. 1 to 100.',
    group: 'Devices',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
  },
  {
    key: 'pushProvider',
    label: 'Browser push plugin',
    description: 'The key of the push plugin browser notifications are sent through when more than one is installed. If it is not installed, the first configured plugin is used. Native app notifications do not use a plugin.',
    group: 'Delivery',
    type: 'text',
    defaultValue: 'webpush',
    placeholder: 'webpush',
  },
];
