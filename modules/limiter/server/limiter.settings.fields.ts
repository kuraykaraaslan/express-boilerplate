import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the rate-limit settings page (/admin/platform/rate-limits/settings, ROOT tenant only). The limiter reads the values
// from the ROOT tenant, cached for 30 seconds (limiter.settings-policy.ts); each one can only make the built-in protection stricter.
export const LIMITER_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'limiterAuthPerMinute',
    label: 'Sign-in requests per address (per minute)',
    description: 'How many sign-in, code, captcha and password reset requests one client address may send a minute: 5 to 20 (the built-in limit). A higher value changes nothing.',
    group: 'Sign-in protection',
    type: 'number',
    defaultValue: '20',
    placeholder: '20',
    rootOnly: true,
  },
  {
    key: 'limiterLoginPerMinute',
    label: 'Login attempts per address (per minute)',
    description: 'How many login attempts one client address may make a minute, on top of the limit above: 3 to 10 (the built-in limit). When the server sets a lower login limit, the lower one applies.',
    group: 'Sign-in protection',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
    rootOnly: true,
  },
  {
    key: 'limiterStrikeThreshold',
    label: 'Failed sign-ins before an address is banned',
    description: 'How many failed sign-ins from one address, on any accounts, within 10 minutes ban that address: 3 to 10 (the built-in threshold).',
    group: 'Address bans',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
    rootOnly: true,
  },
  {
    key: 'limiterBanBaseMinutes',
    label: 'First ban length (minutes)',
    description: 'How long the first automatic ban of an address lasts; every repeat doubles it, up to 7 days: 60 (the built-in length) to 10080 minutes. A manual ban without a length takes it too.',
    group: 'Address bans',
    type: 'number',
    defaultValue: '60',
    placeholder: '60',
    rootOnly: true,
  },
  {
    key: 'limiterApiPerMinute',
    label: 'Anonymous API requests per address (per minute)',
    description: 'How many API requests one client address may send a minute without signing in: 30 to 120 (the built-in limit). Signed-in people keep their own limits, and a tenant\'s plan allowance is not changed.',
    group: 'API traffic',
    type: 'number',
    defaultValue: '120',
    placeholder: '120',
    rootOnly: true,
  },
];
