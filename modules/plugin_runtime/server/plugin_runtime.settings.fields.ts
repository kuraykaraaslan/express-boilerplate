import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the plugin sandbox settings page (/admin/plugins/settings, ROOT tenant only). The broker reads the values
// from the ROOT tenant on every call (plugin_runtime.settings-policy.ts); each one only lowers a built-in ceiling.
export const PLUGIN_RUNTIME_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'pluginPresignMaxSeconds',
    label: 'Longest file link (seconds)',
    description: 'How long a signed file link a plugin asks for may stay valid at most: 60 to 604800 seconds (7 days, the built-in ceiling). A plugin asking for longer gets this.',
    group: 'Storage',
    type: 'number',
    defaultValue: '604800',
    placeholder: '604800',
    rootOnly: true,
  },
  {
    key: 'pluginUploadMaxMb',
    label: 'Largest file upload (MB)',
    description: 'The largest file a plugin may store in one call: 1 to 10 MB (the built-in ceiling).',
    group: 'Storage',
    type: 'number',
    defaultValue: '10',
    placeholder: '10',
    rootOnly: true,
  },
  {
    key: 'pluginKvMaxValueKb',
    label: 'Largest stored value (KB)',
    description: 'The largest value a plugin may save in its key-value data in one write: 1 to 256 KB (the built-in ceiling). Values already stored stay readable.',
    group: 'Plugin data',
    type: 'number',
    defaultValue: '256',
    placeholder: '256',
    rootOnly: true,
  },
];
