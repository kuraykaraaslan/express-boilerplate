import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the telemetry settings page (/admin/telemetry/settings, ROOT tenant only). The minute rollup job reads the
// values from the ROOT tenant on every pass (telemetry.settings-policy.ts).
export const TELEMETRY_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'telemetryRollupDbSharePercent',
    label: 'Rollup database share (%)',
    description: 'How much of a database connection the minute rollup may use while it catches up: 5 to 100. After each catch-up step it rests so the writers keep the rest. Lower is gentler on the writers, higher catches up faster.',
    group: 'Minute rollup',
    type: 'number',
    defaultValue: '50',
    placeholder: '50',
    rootOnly: true,
  },
  {
    key: 'telemetryRollupMaxSteps',
    label: 'Steps per tenant and class in one pass',
    description: 'How many rollup steps one pass makes for a tenant and retention class before it moves on: 1 to 120. What is left continues on the next minute. The pass stops after 50 seconds whatever this is.',
    group: 'Minute rollup',
    type: 'number',
    defaultValue: '30',
    placeholder: '30',
    rootOnly: true,
  },
  {
    key: 'telemetryRollupFullSweepEvery',
    label: 'Full sweep every (passes)',
    description: 'Every how many passes the rollup visits every tenant that ever wrote readings instead of only the recently written ones: 1 to 60 (1 = every pass).',
    group: 'Minute rollup',
    type: 'number',
    defaultValue: '15',
    placeholder: '15',
    rootOnly: true,
  },
];
