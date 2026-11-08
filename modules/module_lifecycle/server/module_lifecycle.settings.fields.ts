import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the module lifecycle settings page (/admin/platform/modules/settings, ROOT tenant only). The value is
// read from the ROOT tenant on every uninstall and delete preview (module_lifecycle.settings-policy.ts). No default value:
// an empty field is the installation's MODULE_RESTORE_WINDOW_DAYS, which differs per installation.
export const MODULE_LIFECYCLE_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'moduleRestoreWindowDays',
    label: 'Restore window (days)',
    description: 'How many days an uninstalled module keeps its data, restorable, before the daily purge removes it: 1 to 3650, for every tenant. Applies to uninstalls from now on. Leave empty for the installation default (MODULE_RESTORE_WINDOW_DAYS, 30 when not set).',
    group: 'Uninstall',
    type: 'number',
    placeholder: '30',
    rootOnly: true,
  },
];
