import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the ROOT geo-IP settings page (/admin/settings/geo-ip). Both keys are the installation's: the geo
// lookup reads them from the ROOT tenant only (common/server/user_agent/user_agent.geo.service.ts), whatever tenant a
// sign-in is for. Unset = the keyless ipinfo default (MS-34; ip-api has no keyless https endpoint, so it needs a key).
export const USER_SESSION_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'geoIpProvider',
    label: 'Geo-IP provider',
    description:
      'Where a sign-in address is located, for impossible-travel and new-country checks and the session list. One provider for the whole installation. ipinfo works without a key. ip-api needs an API key (it has no keyless https endpoint); without one the lookup uses ipinfo. ipgeolocation needs an API key.',
    group: 'Geo-IP lookup',
    type: 'select',
    options: [
      { value: 'ipinfo', label: 'ipinfo' },
      { value: 'ip-api', label: 'ip-api (API key required)' },
      { value: 'ipgeolocation', label: 'ipgeolocation (API key required)' },
    ],
    defaultValue: 'ipinfo',
    rootOnly: true,
  },
  {
    key: 'geoIpApiKey',
    label: 'Geo-IP API key',
    description:
      'The provider key: the ipinfo token (optional), the ip-api key (required; uses its paid https endpoint), or the ipgeolocation API key (required). Stored encrypted.',
    group: 'Geo-IP lookup',
    type: 'secret',
    rootOnly: true,
  },
];
