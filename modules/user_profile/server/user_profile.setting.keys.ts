import { z } from 'zod';

/**
 * The user_profile module's setting keys (2026-10-27), read per tenant:
 * - `reservedDisplayNames`, `profileCustomFields`: the tenant's extra blocked display names and its custom-field
 *   allowlist (user_profile.helpers.ts: assertNameAllowed, filterCustomFields).
 * - `avatarModeration*`: the avatar / header image moderation provider (user_profile.moderation.service.ts).
 *
 * All but `avatarModerationUrl` are on /admin/settings/profiles. `avatarModerationUrl` (the `generic` provider's endpoint)
 * is declared so it is owned, and kept off the page while the request to it is not SSRF-guarded (known bug
 * user_profile.02, user_profile.profile.security.test.ts).
 */
export const UserProfileSettingKeySchema = z.enum([
  'reservedDisplayNames',
  'profileCustomFields',
  'avatarModerationProvider',
  'avatarModerationApiUser',
  'avatarModerationApiKey',
  'avatarModerationThreshold',
  'avatarModerationUrl',
]);
export type UserProfileSettingKey = z.infer<typeof UserProfileSettingKeySchema>;
export const USER_PROFILE_SETTING_KEYS = UserProfileSettingKeySchema.options;
