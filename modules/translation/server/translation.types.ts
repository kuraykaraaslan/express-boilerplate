// Shapes shared by the translation store, its cache and its routes.

/**
 * The platform a stored text is for. A row's `platform` is one of these or NULL,
 * and NULL means the text is shared by every platform.
 */
export const TRANSLATION_PLATFORMS = ['web', 'mobile'] as const;
export type TranslationPlatform = (typeof TRANSLATION_PLATFORMS)[number];

/**
 * What a version is computed over: one platform (its rows plus the shared rows),
 * or `all` (every row, whatever its platform) for a caller that names no platform.
 */
export type TranslationScope = TranslationPlatform | 'all';

/** Flat key → text, as in `modules/<id>/dictionaries/en.json`. */
export type TranslationMessages = Record<string, string>;

/** module → version of that module's texts, in one locale and scope. */
export type TranslationVersions = Record<string, string>;

/** One module's texts in one locale for one platform, with the version they carry. */
export type TranslationBundle = { version: string; messages: TranslationMessages };

/** A text to store. `platform` null = shared by web and mobile. */
export type TranslationEntry = {
  locale: string;
  module: string;
  platform: TranslationPlatform | null;
  key: string;
  value: string;
};

/** Identifies one stored text. */
export type TranslationRef = Omit<TranslationEntry, 'value'>;
