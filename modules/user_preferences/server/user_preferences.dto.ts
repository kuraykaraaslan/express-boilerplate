import { z } from 'zod';
import { TimezoneSchema } from '@kuraykaraaslan-labs/common';
import {
  ThemeEnum,
  LanguageEnum,
  DateFormatEnum,
  TimeFormatEnum,
  FirstDayOfWeekEnum
} from './user_preferences.enums';

/**
 * A preferences save. Every field is optional, and absent or `null` means
 * "leave it as it is".
 *
 * Until 2026-09-25 every field was required and `null` was rewritten to a
 * hard-coded value. `newsletter: null` became `true`, a marketing consent
 * nobody gave, and `theme: null` became `LIGHT` although the stored default
 * is `SYSTEM`. The service then parsed this 10-field body with zod 4's
 * `.partial()`, which keeps defaults, so each save also reset the fields the
 * body does not carry. Currency and number format went back to default,
 * `productUpdates` consent was re-granted, and the consent timestamps were
 * wiped.
 */
const keep = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined)

export const UpdatePreferencesRequestSchema = z.object({
  theme: keep(ThemeEnum),
  language: keep(LanguageEnum),
  emailNotifications: keep(z.boolean()),
  smsNotifications: keep(z.boolean()),
  pushNotifications: keep(z.boolean()),
  channelPrefs: keep(z.record(z.string().regex(/^[a-z][a-z0-9_]{1,31}$/), z.boolean())),
  newsletter: keep(z.boolean()),
  // 06-user 1.3: every consent defaults off, so each must be grantable here, or its category could never reach anyone.
  productUpdates: keep(z.boolean()),
  promotionalOffers: keep(z.boolean()),
  // General announcements by mail, push and SMS (docs/phases/47-announcements, D16): opt-out, so it is switched off here.
  announcements: keep(z.boolean()),
  timezone: keep(TimezoneSchema),
  dateFormat: keep(DateFormatEnum),
  timeFormat: keep(TimeFormatEnum),
  firstDayOfWeek: keep(FirstDayOfWeekEnum),
});

export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequestSchema>;
