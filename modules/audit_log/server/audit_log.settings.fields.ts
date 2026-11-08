import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';
import { AUDIT_LOG_SETTING_KEYS } from './audit_log.setting.keys';

// UI metadata for the Audit Logs settings page (ModuleSettingsPage).
export const AUDIT_LOG_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: AUDIT_LOG_SETTING_KEYS.RETENTION_DAYS,
    label: 'Retention Period (days)',
    description:
      'How long to keep audit-log rows before the retention purge deletes them. 0 = keep forever. ' +
      'Set per compliance needs (e.g. 30 for storage control, 2555 for a 7-year regulatory hold). ' +
      'Rows are optionally archived to NDJSON before deletion.',
    group: 'Retention',
    type: 'number',
    defaultValue: '0',
    placeholder: '0',
  },
  {
    key: AUDIT_LOG_SETTING_KEYS.MAX_PAGE_SIZE,
    label: 'Max Page Size',
    description:
      'Upper bound on the pageSize a caller may request from GET /audit-logs for this tenant. ' +
      'Unset or invalid falls back to 100; the value is always clamped to a hard cap of 500.',
    group: 'Listing',
    type: 'number',
    defaultValue: '100',
    placeholder: '100',
  },
];
