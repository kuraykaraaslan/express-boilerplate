import { z } from 'zod';
import tags from 'language-tags';
import { LANGUAGE_CODES as GENERATED_LANGUAGE_CODES, LANGUAGE_NAMES } from './common.codes.generated';

/**
 * Locale & language primitives for a multi-country SaaS — generated, not
 * hand-maintained:
 *  - Languages are single-sourced from `modules/localization` via build-time
 *    codegen (`npm run gen:localization-codes`). That set is the full ISO 639-1
 *    list minus the withdrawn subtags (`sh`) plus the ISO 639-3 Turkic minority
 *    languages. Before DUP-05 this file read `countries-list` directly, so
 *    localization's catalogue policy and the validator that actually accepts
 *    input could disagree.
 *  - BCP-47 locale strings (`tr-TR`, `pt-BR`) are validated against the IANA
 *    language-subtag registry via the `language-tags` package.
 */

// ── Languages (single-sourced from localization) ────────────────────────────
type RawLanguage = { name: string; native: string };

const LANGUAGE_DATA = LANGUAGE_NAMES as Record<string, RawLanguage>;
const LANGUAGE_CODES = GENERATED_LANGUAGE_CODES as unknown as [string, ...string[]];

export const LanguageCodeEnum = z.enum(LANGUAGE_CODES);
export type LanguageCode = z.infer<typeof LanguageCodeEnum>;

/** Platform default UI language (ISO 639-1). Pairs with `DEFAULT_LOCALE`. */
export const DEFAULT_LANGUAGE: LanguageCode = 'en';

export const LANGUAGES: { code: LanguageCode; name: string; native: string }[] =
  LANGUAGE_CODES.map((code) => ({
    code: code as LanguageCode,
    name: LANGUAGE_DATA[code]?.name ?? code,
    native: LANGUAGE_DATA[code]?.native ?? code,
  }));

/** True if `v` is a known ISO 639-1 language code. */
export function isLanguageCode(v: string): v is LanguageCode {
  return Object.prototype.hasOwnProperty.call(LANGUAGE_DATA, v);
}

// ── BCP-47 locales (validated via language-tags) ───────────────────────────
// Defined in a dependency-free leaf so client code can read the default without this
// file's registry; re-exported so existing imports keep working.
export { DEFAULT_LOCALE, type LocaleCode } from './common.locale-default';
import type { LocaleCode } from './common.locale-default';

/** True if `v` is a well-formed, registered BCP-47 language tag. */
export function isLocaleCode(v: string): boolean {
  try {
    return tags(v).valid();
  } catch {
    return false;
  }
}

/** Zod schema validating a BCP-47 locale string against the IANA registry. */
export const LocaleSchema = z
  .string()
  .refine(isLocaleCode, { message: 'Invalid BCP-47 locale' });

/**
 * Back-compat alias. Previously a fixed `z.enum`; now a registry-validated
 * string schema so any valid BCP-47 locale is accepted (no curated list).
 */
export const LocaleCodeEnum = LocaleSchema;

/**
 * Normalise arbitrary user / `Accept-Language` input into a valid locale:
 *  - canonicalise casing (`tr_tr` → `tr-TR`) and return it if registered,
 *  - else fall back to the bare language subtag (`tr`) if known,
 *  - else `null`.
 */
// Default region for expanding a bare language code to a full locale (tr → tr-TR).
const DEFAULT_LOCALE_REGION: Record<string, string> = {
  en: 'US', tr: 'TR', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL',
  ru: 'RU', ar: 'SA', zh: 'CN', ja: 'JP', ko: 'KR', pl: 'PL', uk: 'UA', hi: 'IN',
  id: 'ID', vi: 'VN', th: 'TH', fa: 'IR', cs: 'CZ', sv: 'SE', da: 'DK', fi: 'FI',
  el: 'GR', he: 'IL', hu: 'HU', ro: 'RO', nb: 'NO', bg: 'BG', hr: 'HR', sk: 'SK',
};

export function parseLocale(input?: string | null): LocaleCode | null {
  if (!input) return null;
  const trimmed = input.replace(/_/g, '-').trim();
  if (!trimmed) return null;

  const [langRaw, regionRaw] = trimmed.split('-');
  const lang = langRaw.toLowerCase();
  const canonical = regionRaw ? `${lang}-${regionRaw.toUpperCase()}` : lang;

  if (isLocaleCode(canonical)) return canonical;
  // Expand a bare, region-less language code to its default full locale (tr → tr-TR).
  if (!regionRaw && isLanguageCode(lang)) {
    const region = DEFAULT_LOCALE_REGION[lang];
    if (region) {
      const expanded = `${lang}-${region}`;
      if (isLocaleCode(expanded)) return expanded;
    }
    return lang;
  }
  if (isLanguageCode(lang)) return lang;
  return null;
}

/**
 * Display list for language dropdowns — derived from the library language data.
 * (`LOCALES` name kept for back-compat; entries are ISO 639-1 languages.)
 */
export const LOCALES: { code: LanguageCode; label: string; nativeLabel: string }[] =
  LANGUAGES.map((l) => ({ code: l.code, label: l.name, nativeLabel: l.native }));
