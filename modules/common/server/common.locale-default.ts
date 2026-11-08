/**
 * The platform default locale, with no dependencies.
 *
 * `common.locale` re-exports these, but it also loads zod and `language-tags`
 * (the 1.6 MB IANA subtag registry) to validate tags. Code that only needs the
 * default, such as money formatting in client bundles, imports it from here.
 */

/** A BCP-47 locale string, e.g. `en-US`, `tr-TR`, or a bare language `tr`. */
export type LocaleCode = string;

export const DEFAULT_LOCALE: LocaleCode = 'en-US';
