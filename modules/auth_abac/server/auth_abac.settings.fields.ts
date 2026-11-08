import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';
import { AUTH_ABAC_SETTING_KEYS } from './auth_abac.setting.keys';

// UI metadata for the ABAC settings page (rendered by ModuleSettingsPage as a
// header-action / sub-page of the Access Policies screen — not a separate
// sidebar item, per the house rule). Drives the safe-rollout knobs.
export const AUTH_ABAC_SETTINGS_FIELDS: SettingFieldDef[] = [
  // ── Rollout ──────────────────────────────────────────────────────────────
  {
    key: AUTH_ABAC_SETTING_KEYS.SHADOW_MODE,
    label: 'Shadow Mode',
    description:
      'When enabled, policies are evaluated and decisions are logged, but a "deny" NEVER blocks the request (403 is not thrown). Use it to validate policies against real traffic before enforcing. Disable to enforce.',
    group: 'Rollout',
    type: 'boolean',
    defaultValue: 'false',
    // Platform-wide (S3): a tenant's own value is ignored by the guard and refused on write, so a tenant ADMIN cannot void OWNER policies.
    rootOnly: true,
  },
  {
    key: AUTH_ABAC_SETTING_KEYS.DECISION_LOG_MODE,
    label: 'Decision Log Mode',
    description:
      'How much of the decision stream is written to the audit log. "All" logs every evaluation, "Deny only" cuts noise/cost by logging just denies, "Off" disables decision logging.',
    group: 'Rollout',
    type: 'select',
    options: [
      { value: 'all', label: 'All decisions' },
      { value: 'deny_only', label: 'Deny only' },
      { value: 'off', label: 'Off' },
    ],
    defaultValue: 'all',
    // Platform-wide (S3): a tenant cannot switch off the evidence of its denies.
    rootOnly: true,
  },
  {
    key: AUTH_ABAC_SETTING_KEYS.DECISION_LOG_SAMPLE_RATE,
    label: 'Permit Log Sample Rate (%)',
    description:
      'Percentage (0-100) of PERMIT decisions written to the audit log. Lower it on high-traffic tenants where logging every permit is mostly noise. Denies are always logged, and sampled rows record their rate so counts can be scaled back up.',
    group: 'Rollout',
    type: 'number',
    placeholder: '100',
  },
  // ── Safety ───────────────────────────────────────────────────────────────
  {
    key: AUTH_ABAC_SETTING_KEYS.REGEX_TIMEOUT_MS,
    label: 'Regex Match Budget (ms)',
    description:
      'Time budget for a user-defined "regex" rule operator — a ReDoS guard. Applies to policies that match attributes with regular expressions.',
    group: 'Safety',
    type: 'number',
    placeholder: '250',
  },
];
