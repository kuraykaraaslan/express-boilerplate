import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';
import { API_KEY_SETTING_KEYS } from './api_key.setting.keys';

// UI metadata for the API Keys settings page. Keys cover the non-env settings
// (env:* cache TTL is deployment config and excluded).
export const API_KEY_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: API_KEY_SETTING_KEYS.NEGATIVE_CACHE_TTL_SECONDS,
    label: 'Negative Cache TTL (seconds)',
    description: 'How long to cache a "no such API key" result, in seconds. Minimum 60. Platform-wide value (read from the root tenant).',
    group: 'Caching',
    type: 'number',
    placeholder: '60',
  },
  {
    key: API_KEY_SETTING_KEYS.MAX_ACTIVE_KEYS,
    label: 'Max Active Keys',
    description: 'Maximum number of active API keys this tenant may hold at once. 0 = unlimited.',
    group: 'Lifecycle',
    type: 'number',
    defaultValue: '0',
    placeholder: '0',
  },
  {
    key: API_KEY_SETTING_KEYS.MAX_TTL_DAYS,
    label: 'Maximum Key Lifetime (days)',
    description: 'Cap on how far in the future a key may be set to expire. Every key expires: 90 days by default, at most 365. A lower number here lowers both; 0 = the 365-day platform cap.',
    group: 'Lifecycle',
    type: 'number',
    defaultValue: '0',
    placeholder: '0',
  },
  {
    key: API_KEY_SETTING_KEYS.REQUIRE_EXPIRY,
    label: 'Require Expiry on Every Key',
    description: 'Every new key expires (90 days unless a date is given). When enabled, an API call that creates a key must name its expiry date instead of taking the 90-day default.',
    group: 'Lifecycle',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: API_KEY_SETTING_KEYS.TENANT_IP_ALLOWLIST,
    label: 'Tenant Subnet Allowlist',
    description: 'Comma/space-separated subnets (CIDR) applied as a default to every key that does not declare its own allowlist. A single host is a /32 (e.g. 192.168.1.182/32). Leave blank to allow all.',
    group: 'Network',
    type: 'textarea',
    placeholder: '203.0.113.0/24, 192.168.1.182/32',
  },
  {
    key: API_KEY_SETTING_KEYS.DEFAULT_RATE_LIMIT_PER_MINUTE,
    label: 'Per-Key Rate Limit (requests/minute)',
    description: 'Default maximum verifications per minute for each key. 0 = unlimited.',
    group: 'Network',
    type: 'number',
    defaultValue: '0',
    placeholder: '0',
  },
  {
    key: API_KEY_SETTING_KEYS.ALLOWED_ENVIRONMENTS,
    label: 'Key Environments',
    description: 'Comma-separated environment namespaces baked into the raw-key prefix (e.g. live, test, staging). Documents which environments your integrations may mint keys for. Leave blank to use the built-in live/test defaults.',
    group: 'Environments',
    type: 'text',
    placeholder: 'live, test, staging',
  },
];
