/**
 * THE data seam. Every reference row this module publishes enters through here.
 *
 * The origin is the COMMITTED projection in `../data/*.generated.ts`, produced
 * by `modules/localization/scripts/gen-localization-data.mts` from public npm packages —
 * `countries-list`, `iso-639-1`, `country-flag-icons`, `libphonenumber-js` —
 * plus `../data/localization.overlay.ts`, the hand-maintained rows no public
 * package carries (the TRNC as `CT`, the Turkic 639-3 languages, the Cyprus
 * naming, RTL flags). Refreshing the data is a deliberate, reviewed
 * `npm run gen:localization-data`, never part of install or build.
 *
 * ── Why a committed projection and not runtime imports ──────────────────────
 * The catalogues below are consts consumed inside 'use client' components — a
 * bundle rendering a LanguageSelect must not carry libphonenumber's metadata or
 * the full flag barrel. The generator reads those packages in Node, at
 * generation time, and emits picker-sized rows (~8 KB of languages). Artwork is
 * an order of magnitude larger than the rows, so it has its own seam
 * (`./flag-art.source`) over its own generated file — asking for a language
 * label must not cost every flag.
 *
 * ── Contract for a future origin ────────────────────────────────────────────
 * These accessors are SYNCHRONOUS and read at module-evaluation time, because
 * of those client-component consts. Any origin must therefore be materialised
 * BEFORE import.
 *
 * ── What the source does NOT decide ─────────────────────────────────────────
 * Curated POLICY stays with the catalogue that applies it, because it is this
 * product's opinions rather than reference data:
 *   - `./regions`   — the non-sovereign Turkic regions & peoples ISO omits.
 *   - `./countries` — LABEL_OVERRIDES.
 *   - `./languages` — LANG_FLAG, the deprecated-subtag exclusion, the
 *                     presentation order.
 * Language DIRECTION is not policy — it rides in the row's 4th slot. (The
 * overlay records it because `iso-639-1` carries no direction data; it is still
 * reference data, captured once, not a per-release judgement.)
 */
import { RAW_LANGUAGES } from '../data/languages.generated';
import { RAW_COUNTRIES } from '../data/countries.generated';
import { RAW_CURRENCIES } from '../data/currencies.generated';
import { RAW_DIALING } from '../data/dialing.generated';

/**
 * The language codes the source can actually name.
 *
 * Re-exported so that nothing but this seam names the generated files, and so
 * `./regions` can constrain its seed to it: a region that speaks a language the
 * catalogue cannot name is then a COMPILE error, where it used to be a throw in
 * a build script nobody ran on every edit. (The generator asserts the same
 * invariant at generation time.)
 */
export type { GeneratedLanguageCode as CatalogueLanguageCode } from '../data/languages.generated';

/**
 * The row shapes, declared HERE rather than imported from the generated files.
 *
 * Deliberate: this is the one place the contract is written down, so a
 * generator that changes shape breaks at the seam with a readable error instead
 * of silently reshaping 250-odd rows the catalogues then misread.
 */
export type RawLanguage = readonly [code: string, native: string, english: string, rtl?: 1];
export type RawCountry = {
  iso2: string; iso3: string; name: string; native: string;
  currency: string[]; languages: string[];
};
export type RawCurrency = { code: string; name: string; symbol: string; country: string };
export type RawDialing = {
  iso2: string; callingCode: string; primary?: true; leadingDigits?: string;
  nationalPrefix?: string; nsnLengths: number[]; exampleNumber?: string;
};

/** The origin of the reference rows. Implement this to move the data elsewhere. */
export type LocalizationSource = {
  languages(): ReadonlyArray<RawLanguage>;
  countries(): ReadonlyArray<RawCountry>;
  currencies(): ReadonlyArray<RawCurrency>;
  dialing(): ReadonlyArray<RawDialing>;
};

/** The committed projection under `../data/`. */
export const generatedSource: LocalizationSource = {
  languages: () => RAW_LANGUAGES,
  countries: () => RAW_COUNTRIES,
  currencies: () => RAW_CURRENCIES,
  dialing: () => RAW_DIALING,
};

/**
 * The active source. Point this at another `LocalizationSource` to change where
 * every catalogue reads from — the ONE line a migration touches.
 */
export const localizationSource: LocalizationSource = generatedSource;

export const rawLanguages = (): ReadonlyArray<RawLanguage> => localizationSource.languages();
export const rawCountries = (): ReadonlyArray<RawCountry> => localizationSource.countries();
export const rawCurrencies = (): ReadonlyArray<RawCurrency> => localizationSource.currencies();
export const rawDialing = (): ReadonlyArray<RawDialing> => localizationSource.dialing();
