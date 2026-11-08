import { z } from 'zod';
import { TimezoneSchema, DEFAULT_TIMEZONE, DEFAULT_LANGUAGE, CurrencyCodeEnum, DEFAULT_CURRENCY } from '@kuraykaraaslan-labs/common';
import {
  ThemeEnum,
  LanguageEnum,
  DateFormatEnum,
  TimeFormatEnum,
  FirstDayOfWeekEnum,
  NumberFormatEnum,
  MeasurementSystemEnum
} from './user_preferences.enums';

// Bump whenever a new persisted preference field is added. Stored rows / cached
// payloads carrying an older version are migrated forward on read.
export const PREFERENCES_SCHEMA_VERSION = 2;

export const UserPreferencesSchema = z.object({
  theme: ThemeEnum.default('SYSTEM'),
  language: LanguageEnum.default(DEFAULT_LANGUAGE),
  // Locale-aware formatting preferences
  currency: CurrencyCodeEnum.default(DEFAULT_CURRENCY),
  numberFormat: NumberFormatEnum.default('DOT_COMMA'),
  measurementSystem: MeasurementSystemEnum.default('METRIC'),
  timezone: TimezoneSchema.default(DEFAULT_TIMEZONE),
  dateFormat: DateFormatEnum.default('DD_MM_YYYY'),
  timeFormat: TimeFormatEnum.default('H24'),
  firstDayOfWeek: FirstDayOfWeekEnum.default('MON'),
  // Notification channels
  emailNotifications: z.boolean().default(true),
  smsNotifications: z.boolean().default(false),
  pushNotifications: z.boolean().default(true),
  // Per-channel toggles for channels WITHOUT a dedicated column above (a fifth
  // channel such as `telegram`). A missing key means "allowed". No schema
  // version bump: older rows/caches parse to `{}`, which is the default.
  channelPrefs: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,31}$/), z.boolean()).default({}),
  // Granular marketing consent (GDPR Recital 32 — specific, separate consents). Opt-in: every one defaults OFF (06-user 1.3).
  newsletter: z.boolean().default(false),
  productUpdates: z.boolean().default(false),
  promotionalOffers: z.boolean().default(false),
  // General announcements of the platform or the workspace by mail, push and SMS (docs/phases/47-announcements, D16): an
  // opt-OUT category, on by default. Maintenance notices are service mail and do not ask it. No schema version bump: older
  // rows and caches parse to the default.
  announcements: z.boolean().default(true),
  // Consent evidence — when each marketing consent was last granted/changed
  newsletterConsentAt: z.coerce.date().nullable().default(null),
  marketingConsentAt: z.coerce.date().nullable().default(null),
  // Schema version for safe cache/row migration
  schemaVersion: z.number().int().default(PREFERENCES_SCHEMA_VERSION),
});

export const UserPreferencesDefault: UserPreferences = {
  theme: 'SYSTEM',
  language: DEFAULT_LANGUAGE,
  currency: DEFAULT_CURRENCY,
  numberFormat: 'DOT_COMMA',
  measurementSystem: 'METRIC',
  timezone: 'UTC',
  dateFormat: 'DD_MM_YYYY',
  timeFormat: 'H24',
  firstDayOfWeek: 'MON',
  emailNotifications: true,
  smsNotifications: false,
  pushNotifications: true,
  channelPrefs: {},
  // Marketing consents are opt-in, never a default (06-user 1.3).
  newsletter: false,
  productUpdates: false,
  promotionalOffers: false,
  announcements: true,
  newsletterConsentAt: null,
  marketingConsentAt: null,
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
};

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

/** Per-tenant default preferences applied to a user's first row. */
export interface TenantPreferenceDefaults {
  language?: UserPreferences['language'];
  timezone?: UserPreferences['timezone'];
  currency?: UserPreferences['currency'];
  theme?: UserPreferences['theme'];
  numberFormat?: UserPreferences['numberFormat'];
  measurementSystem?: UserPreferences['measurementSystem'];
  dateFormat?: UserPreferences['dateFormat'];
  timeFormat?: UserPreferences['timeFormat'];
  firstDayOfWeek?: UserPreferences['firstDayOfWeek'];
}
