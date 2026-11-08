import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the member preference defaults page (/admin/settings/member-preferences). Each value is the default a
// member gets until they save their own preferences (UserPreferencesService.getTenantDefaults); a person's own choice
// always wins. Defaults equal the global ones (UserPreferencesDefault), so an unset key changes nothing. The values are
// the preferences schema's enums (user_preferences.enums.ts); a value outside them is dropped on read.
export const USER_PREFERENCES_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'defaultTheme',
    label: 'Default theme',
    description: 'The theme a member sees until they choose their own.',
    group: 'Look',
    type: 'select',
    options: [
      { value: 'SYSTEM', label: 'Follow the device' },
      { value: 'LIGHT', label: 'Light' },
      { value: 'DARK', label: 'Dark' },
    ],
    defaultValue: 'SYSTEM',
  },
  {
    key: 'defaultDateFormat',
    label: 'Default date format',
    description: 'How dates are written for a member who has not chosen a format.',
    group: 'Formats',
    type: 'select',
    options: [
      { value: 'DD_MM_YYYY', label: 'DD/MM/YYYY' },
      { value: 'MM_DD_YYYY', label: 'MM/DD/YYYY' },
      { value: 'YYYY_MM_DD', label: 'YYYY-MM-DD' },
    ],
    defaultValue: 'DD_MM_YYYY',
  },
  {
    key: 'defaultTimeFormat',
    label: 'Default time format',
    description: 'A 24-hour or a 12-hour clock for a member who has not chosen one.',
    group: 'Formats',
    type: 'select',
    options: [
      { value: 'H24', label: '24-hour (14:30)' },
      { value: 'H12', label: '12-hour (2:30 PM)' },
    ],
    defaultValue: 'H24',
  },
  {
    key: 'defaultFirstDayOfWeek',
    label: 'Default first day of the week',
    description: 'The day calendars start on for a member who has not chosen one.',
    group: 'Formats',
    type: 'select',
    options: [
      { value: 'MON', label: 'Monday' },
      { value: 'SUN', label: 'Sunday' },
    ],
    defaultValue: 'MON',
  },
  {
    key: 'defaultNumberFormat',
    label: 'Default number format',
    description: 'The thousands and decimal separators for a member who has not chosen them.',
    group: 'Formats',
    type: 'select',
    options: [
      { value: 'DOT_COMMA', label: '1,234.56' },
      { value: 'COMMA_DOT', label: '1.234,56' },
      { value: 'SPACE_COMMA', label: '1 234,56' },
      { value: 'INDIAN', label: '1,00,000.00 (Indian grouping)' },
    ],
    defaultValue: 'DOT_COMMA',
  },
  {
    key: 'defaultMeasurementSystem',
    label: 'Default measurement system',
    description: 'Metric or imperial units for a member who has not chosen.',
    group: 'Formats',
    type: 'select',
    options: [
      { value: 'METRIC', label: 'Metric' },
      { value: 'IMPERIAL', label: 'Imperial' },
    ],
    defaultValue: 'METRIC',
  },
];
