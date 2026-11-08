import { z } from 'zod';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';

// ============================================================================
// Setting Schema
// ============================================================================

export const SettingSchema = z.object({
  tenantId: z.string().uuid().default(ROOT_TENANT_ID),
  key: z.string(),
  value: z.string(),
  group: z.string().default("general"),
  type: z.string().default("string"),
  createdAt: z.date(),
  updatedAt: z.date().nullable(),
});

export type Setting = z.infer<typeof SettingSchema>;

// ============================================================================
// Setting Key Schemas by Group
// ============================================================================
//
// MIS-04: the domain-owned key-enum re-exports that used to live here (auth,
// notification_mail, notification_sms, storage, ai, user_security, payment,
// tenant_subscription) were dead code — grep confirmed zero consumers imported
// them through this module. Each domain's *.setting.keys.ts is the source of
// truth; import from there directly. Removing the re-exports also drops 6 of
// tenant_setting's 9 accepted forward-drift edges (ai/notification_mail/
// notification_sms/storage/user_security/payment) — this ambient module has no
// remaining reason to import those modules at all.

export const IntegrationsSettingKeySchema = z.enum([
  'discordWebhookUrl', 'discordDoormanWebhookUrl',
  'githubTreeUrl', 'githubToken', 'githubUser',
]);
export type IntegrationsSettingKey = z.infer<typeof IntegrationsSettingKeySchema>;
export const INTEGRATIONS_KEYS = IntegrationsSettingKeySchema.options;

export const AnalyticsSettingKeySchema = z.enum([
  'googleTagId',
]);
export type AnalyticsSettingKey = z.infer<typeof AnalyticsSettingKeySchema>;
export const ANALYTICS_KEYS = AnalyticsSettingKeySchema.options;

// MS-16 (2026-10-27): the SEO key enum that lived here is gone. `metaRobots` and `sitemapEnabled` are seo's own
// (seo.setting.keys.ts, owned with seo's permission); `canonicalEnabled`, `ogDefaultImage`, `twitterCardType` and
// `bingWebmasterId` were read by nothing, and `googleSearchConsoleId` only by seo's uncalled `SeoService.renderHead`
// (which declares it there by its own read).

export const SocialSettingKeySchema = z.enum([
  'facebookUrl', 'twitterUrl', 'instagramUrl', 'linkedinUrl', 'youtubeUrl',
  'githubProfileUrl', 'tiktokUrl', 'pinterestUrl',
]);
export type SocialSettingKey = z.infer<typeof SocialSettingKeySchema>;
export const SOCIAL_KEYS = SocialSettingKeySchema.options;

export const LocalizationSettingKeySchema = z.enum([
  'defaultTimezone', 'defaultLanguage',
  // ISO-3166 alpha-2. Doubles as the phone-number parsing region — see
  // ./tenant_setting.country.ts for why that is one shared setting.
  'defaultCountry',
  // Ordered CSV of the site's enabled language codes (default first), e.g.
  // 'en,tr,de'. Authoritative source consumed by dynamic_page routing + SEO.
  'enabledLanguages',
  'dateFormat', 'timeFormat', 'datetimeFormat',
  'weekStartsOn', 'currencySymbol', 'currencyPosition',
  'thousandSeparator', 'decimalSeparator',
]);
export type LocalizationSettingKey = z.infer<typeof LocalizationSettingKeySchema>;
export const LOCALIZATION_KEYS = LocalizationSettingKeySchema.options;

// ============================================================================
// Settings State
// ============================================================================

export const SettingsStateSchema = z.record(z.string(), z.string());
export type SettingsState = z.infer<typeof SettingsStateSchema>;

