import type { TranslationPlatform, TranslationScope } from './translation.types';

/** The platforms a client may name: react-native's `Platform.OS` values (`web` = the Expo web build and the web app). */
export const CLIENT_PLATFORMS = ['android', 'ios', 'web'] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

/** `android` and `ios` read the `mobile` texts; `web` reads the `web` texts. */
export function toStoredPlatform(platform: ClientPlatform): TranslationPlatform {
  return platform === 'web' ? 'web' : 'mobile';
}

/** No platform named = versions over every row, so a client that cannot say which platform it is never misses a change. */
export function toScope(platform: ClientPlatform | null | undefined): TranslationScope {
  return platform ? toStoredPlatform(platform) : 'all';
}

/**
 * The scopes whose versions a change to a row of `platform` moves: a shared row is
 * read by every platform, a platform row by that platform; `all` sees every row.
 */
export function scopesAffectedBy(platform: TranslationPlatform | null): TranslationScope[] {
  return platform === null ? ['web', 'mobile', 'all'] : [platform, 'all'];
}

/** The platforms whose bundles a change to a row of `platform` changes. */
export function platformsAffectedBy(platform: TranslationPlatform | null): TranslationPlatform[] {
  return platform === null ? ['web', 'mobile'] : [platform];
}
