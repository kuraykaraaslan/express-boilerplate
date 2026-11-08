import { z } from 'zod';

/**
 * The user_preferences module's setting keys (2026-10-27): the tenant's defaults for a member who has not saved
 * preferences yet, read per tenant by `UserPreferencesService.getTenantDefaults` (user_preferences.service.ts) and
 * edited on /admin/settings/member-preferences. A person's own saved preferences always win; unset = the global
 * defaults (`UserPreferencesDefault`).
 *
 * The language, timezone and currency defaults the same reader uses (`defaultLanguage`, `defaultTimezone`,
 * `defaultCurrency`) are the tenant's general settings (Settings > General / Localization), not this module's.
 */
export const UserPreferencesSettingKeySchema = z.enum([
  'defaultTheme',
  'defaultNumberFormat',
  'defaultMeasurementSystem',
  'defaultDateFormat',
  'defaultTimeFormat',
  'defaultFirstDayOfWeek',
]);
export type UserPreferencesSettingKey = z.infer<typeof UserPreferencesSettingKeySchema>;
export const USER_PREFERENCES_SETTING_KEYS = UserPreferencesSettingKeySchema.options;
