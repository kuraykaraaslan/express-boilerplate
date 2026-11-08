import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys';

// UI metadata for observability tenant settings.
export const OBSERVABILITY_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: OBSERVABILITY_SETTING_KEYS.STATUS_PAGE_ENABLED,
    label: 'Public status page',
    description: 'Expose /status (components, incidents, uptime) to the internet. Off = the page and its API answer 404.',
    group: 'Status Page',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: OBSERVABILITY_SETTING_KEYS.EXCLUDE_MAINTENANCE_FROM_UPTIME,
    label: 'Exclude maintenance from uptime',
    description:
      'Keep probe samples taken during an announced maintenance window out of the uptime percentage, '
      + 'so the figure describes UNPLANNED availability. Off counts scheduled work as downtime — which '
      + 'punishes announcing it. Applied as samples are taken, so changing this never rewrites past uptime.',
    group: 'Status Page',
    type: 'boolean',
    defaultValue: 'true',
  },
  {
    key: OBSERVABILITY_SETTING_KEYS.BROWSER_CHECKS_ENABLED,
    label: 'Browser checks',
    description:
      'Allow BROWSER monitors (a real headless browser walking a page). They run only in a browser-capable probe runner you operate or the platform publishes, '
      + 'never inside the app, at most every 5 minutes and up to 20 steps. Off = no browser monitor can be created or leased.',
    group: 'Monitors',
    type: 'boolean',
    defaultValue: 'false',
  },
  ...(['CRITICAL', 'MAJOR', 'MINOR', 'WARNING', 'INFO'] as const).map((sev): SettingFieldDef => ({
    key: ({
      CRITICAL: OBSERVABILITY_SETTING_KEYS.INCIDENT_ON_CRITICAL, MAJOR: OBSERVABILITY_SETTING_KEYS.INCIDENT_ON_MAJOR,
      MINOR: OBSERVABILITY_SETTING_KEYS.INCIDENT_ON_MINOR, WARNING: OBSERVABILITY_SETTING_KEYS.INCIDENT_ON_WARNING,
      INFO: OBSERVABILITY_SETTING_KEYS.INCIDENT_ON_INFO,
    })[sev],
    label: `Incident for ${sev} alerts`,
    description: 'What a group of alerts of this severity does about the incident: open one automatically, or only record the alert. A routing rule can override this per alert.',
    group: 'Alerts',
    type: 'select',
    options: [{ value: 'auto', label: 'Open an incident' }, { value: 'never', label: 'Only record the alert' }],
    defaultValue: sev === 'WARNING' || sev === 'INFO' ? 'never' : 'auto',
  })),
  {
    key: OBSERVABILITY_SETTING_KEYS.ALERT_RETENTION_DAYS,
    label: 'Resolved alert retention (days)',
    description: 'How long resolved alerts are kept. Open alerts are never removed. Your plan may cap this number.',
    group: 'Retention', type: 'number', defaultValue: '180',
  },
  {
    key: OBSERVABILITY_SETTING_KEYS.INCIDENT_RETENTION_DAYS,
    label: 'Resolved incident retention (days)',
    description: 'How long resolved incidents and their post-mortems are kept. Open incidents and incidents under legal hold are never removed. Your plan may cap this number.',
    group: 'Retention', type: 'number', defaultValue: '730',
  },
  {
    key: OBSERVABILITY_SETTING_KEYS.ROLLUP_RETENTION_DAYS,
    label: 'Uptime rollup retention (days)',
    description: 'How long the daily uptime rollups (the source of 30, 90 and 365 day uptime) are kept. Empty keeps them for good. Your plan may cap this number.',
    group: 'Retention', type: 'number', defaultValue: '',
  },
  {
    key: OBSERVABILITY_SETTING_KEYS.LEGAL_HOLD,
    label: 'Legal hold on observability records',
    description: 'While on, no alert, incident or post-mortem of this workspace is removed by a retention sweep. Turning it on or off is audited.',
    group: 'Retention', type: 'boolean', defaultValue: 'false',
  },
];
