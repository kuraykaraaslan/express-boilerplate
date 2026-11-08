import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Maintenance → Settings (/admin/maintenance/settings). Keys in tenant.setting.keys.ts; every value is
// checked by tenant.settings-policy.ts, so a bad one is the earlier constant. The cache TTL and the advance-notice lead
// are read from ROOT only (one value for the installation), so they show on the root tenant only.
export const TENANT_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'maintenanceDefaultAllowRoles',
    label: 'Default bypass roles',
    description: 'The member roles that keep working during a maintenance window created without its own list, and what the schedule form starts with. Platform administrators always pass.',
    group: 'Maintenance windows',
    type: 'select',
    options: [
      { value: '["OWNER","ADMIN"]', label: 'Owners and admins' },
      { value: '["OWNER"]', label: 'Owners only' },
    ],
    defaultValue: '["OWNER","ADMIN"]',
  },
  {
    key: 'maintenancePreNotifyHours',
    label: 'Advance notice (hours)',
    description: 'How many hours before a scheduled window starts its one advance notice is sent (1 to 168).',
    group: 'Platform',
    type: 'number',
    defaultValue: '24',
    placeholder: '24',
    rootOnly: true,
  },
  {
    key: 'maintenanceCacheTtlSeconds',
    label: 'Gate cache (seconds)',
    description: 'How long the maintenance gate caches the scheduled windows between checks (5 to 60). A started or ended window always applies at once.',
    group: 'Platform',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
    rootOnly: true,
  },
];
