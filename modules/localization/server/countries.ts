// Countries reference data — rows via ./localization.source (the data seam;
// name/native + languages + currencies per country). Codes are ISO-3166 ALPHA-3
// (`alpha2` kept for flags).
//
// KKTC is NOT a special case here any more: the data source carries the TRNC as
// a country in its own right (`CT` / `CTR`, via data/localization.overlay.ts),
// so it arrives with the rest and is sovereign as far as this catalogue is
// concerned. The pseudo-coded entries that remain are the non-sovereign Turkic
// regions in ./regions.
import { rawCountries, rawDialing } from './localization.source';
import type { CountryInfo, DialingInfo, FlagOption } from './types';
import { REGIONS } from './regions';

// Politically-preferred display labels, overriding the source's English name.
// The source already declines to call CY "Cyprus" — its overlay pins "Greek
// Cypriot Administration of Southern Cyprus" — but it carries the Turkish
// wording only as the native name. Deriving the label from that would tie an
// English-name column to whatever the source records as an endonym, so the
// product's wording stays here, one line, visible.
const LABEL_OVERRIDES: Record<string, string> = {
  CYP: 'Güney Kıbrıs Rum Yönetimi', // Republic of Cyprus
};

const DIAL_BY_ALPHA2 = new Map<string, DialingInfo>(
  rawDialing().map((d) => [
    d.iso2,
    {
      callingCode: d.callingCode,
      ...(d.primary ? { primary: true as const } : {}),
      ...(d.leadingDigits ? { leadingDigits: d.leadingDigits } : {}),
      ...(d.nationalPrefix ? { nationalPrefix: d.nationalPrefix } : {}),
      nsnLengths: d.nsnLengths,
      ...(d.exampleNumber ? { exampleNumber: d.exampleNumber } : {}),
    },
  ]),
);

export const COUNTRIES: CountryInfo[] = (() => {
  const list: CountryInfo[] = rawCountries()
    .map((c) => ({
      code: c.iso3,
      alpha2: c.iso2,
      label: LABEL_OVERRIDES[c.iso3] || c.name,
      native: c.native,
      flag: c.iso2,
      languages: c.languages || [],
      currencies: c.currency || [],
      ...(DIAL_BY_ALPHA2.has(c.iso2) ? { dial: DIAL_BY_ALPHA2.get(c.iso2)! } : {}),
    }));

  // Non-sovereign Turkic regions & peoples (no flag artwork yet — see ./flag-art.source).
  list.push(...REGIONS);

  return list.sort((a, b) => a.label.localeCompare(b.label));
})();

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
const BY_ALPHA2 = new Map(COUNTRIES.map((c) => [c.alpha2, c]));

/** Look up a country by its alpha-3 code (or alpha-2 as a fallback). */
export function getCountry(code: string): CountryInfo | undefined {
  const c = (code || '').toUpperCase();
  return BY_CODE.get(c) ?? BY_ALPHA2.get(c);
}

/** Options for the common FlagSelect / FlagMultiSelect — everything (sovereign + regions). */
export const COUNTRY_OPTIONS: FlagOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.label,
  flag: c.flag,
}));

/** Only non-sovereign regions/peoples — the Turkic regions from ./regions. */
export const REGIONS_ALL: CountryInfo[] = COUNTRIES.filter((c) => c.type === 'region');
export const REGION_OPTIONS: FlagOption[] = REGIONS_ALL.map((c) => ({ value: c.code, label: c.label, flag: c.flag }));

/** Only sovereign ISO countries (excludes every `type: 'region'` entry). */
export const SOVEREIGN_COUNTRIES: CountryInfo[] = COUNTRIES.filter((c) => c.type !== 'region');
export const SOVEREIGN_OPTIONS: FlagOption[] = SOVEREIGN_COUNTRIES.map((c) => ({ value: c.code, label: c.label, flag: c.flag }));

/** Options keyed by ISO-3166 ALPHA-2 (value = alpha-2) — for fields that store
 *  alpha-2 country codes; feed these to the common FlagSelect / FlagMultiSelect.
 *
 *  ⚠️ Includes `type: 'region'` entries whose "alpha-2" is a pseudo-code (the
 *  Turkic regions) that no ISO validator accepts. Use it for **display /
 *  targeting** fields only. For anything a fiscal or logistics DTO validates as
 *  an ISO country, use `SOVEREIGN_ALPHA2_OPTIONS` — offering a pseudo-code in a
 *  picker whose endpoint validates ISO-only is how the tax rate form used to
 *  answer 400 for KKTC (DUP-05). That particular case is now fixed at the source
 *  rather than at the picker: the TRNC is a country here, `CT`, and the
 *  validators accept it. */
export const COUNTRY_ALPHA2_OPTIONS: FlagOption[] = COUNTRIES.map((c) => ({ value: c.alpha2, label: c.label, flag: c.flag }));

/** Alpha-2 options restricted to sovereign ISO countries — the picker shape for
 *  every field validated against an ISO 3166-1 alpha-2 enum. */
export const SOVEREIGN_ALPHA2_OPTIONS: FlagOption[] = SOVEREIGN_COUNTRIES
  .map((c) => ({ value: c.alpha2, label: c.label, flag: c.flag }));

/** Sovereign ISO 3166-1 alpha-2 codes. The build-time source for the platform's
 *  country Zod enum — see `modules/localization/scripts/gen-localization-codes.mts`. */
export const SOVEREIGN_ALPHA2_CODES: string[] = SOVEREIGN_COUNTRIES.map((c) => c.alpha2);

/** Countries where a language (ISO 639-1) is spoken. */
export function countriesForLanguage(lang: string): CountryInfo[] {
  const l = (lang || '').toLowerCase().split('-')[0];
  return COUNTRIES.filter((c) => c.languages.includes(l));
}

/** Currency codes used by a country (alpha-3 or alpha-2). */
export function currenciesForCountry(code: string): string[] {
  return getCountry(code)?.currencies ?? [];
}

// ── Dialing ──────────────────────────────────────────────────────────────────

/** A country's E.164 dialing plan (alpha-3 or alpha-2). */
export function getDialing(code: string): DialingInfo | undefined {
  return getCountry(code)?.dial;
}

/** Countries that have a dialing plan, sorted by label — the phone picker's set. */
export const DIALING_COUNTRIES: CountryInfo[] = COUNTRIES.filter((c) => c.dial);

/**
 * Options for the phone-number country picker. Value is ISO-3166 ALPHA-2,
 * because that is what `libphonenumber-js` takes as its parsing hint and what
 * `parsePhone` returns as `regionCode` — a picker keyed on alpha-3 would need a
 * translation at every call site.
 *
 * The label carries the dial code (`Türkiye (+90)`) so the list stays searchable
 * by either: people look for "Turkey" and for "+90", and typing `90` should not
 * come up empty.
 */
export const DIAL_OPTIONS: FlagOption[] = DIALING_COUNTRIES.map((c) => ({
  value: c.alpha2,
  label: `${c.label} (+${c.dial!.callingCode})`,
  flag: c.flag,
}));

/**
 * The territory that OWNS a calling code — `US` for `+1`, `GB` for `+44`,
 * `TR` for `+90`.
 *
 * Needed because a calling code alone does not identify a country: `+1` maps to
 * 25 territories. When a stored number is rendered back into the picker, the
 * owner is the only defensible default; anything else silently relabels a US
 * number as Jamaican. Accepts the code with or without a leading `+`.
 */
export function primaryCountryForCallingCode(callingCode: string): CountryInfo | undefined {
  const code = (callingCode || '').replace(/^\+/, '');
  if (!code) return undefined;
  const matches = DIALING_COUNTRIES.filter((c) => c.dial!.callingCode === code);
  return matches.find((c) => c.dial!.primary) ?? matches[0];
}
