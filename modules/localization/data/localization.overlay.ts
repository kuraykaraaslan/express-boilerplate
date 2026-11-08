/**
 * HAND-MAINTAINED — not generated. The reference rows no public npm package
 * carries, merged into the committed projection by
 * `modules/localization/scripts/gen-localization-data.mts` (`npm run gen:localization-data`).
 *
 * Everything here was captured verbatim from the data this catalogue shipped
 * before the migration to public packages, so the product's political modelling
 * survives any upstream refresh:
 *   - the TRNC as a country in its own right (`CT` / `CTR`), with its dialing
 *     plan and flag artwork — ISO 3166 does not assign it a code;
 *   - the eleven Turkic ISO 639-3 minority languages `server/regions.ts` speaks,
 *     which ISO 639-1 (and therefore `iso-639-1`) cannot name;
 *   - the Cyprus naming and the Türkiye guard — `countries-list` already says
 *     "Türkiye", but a name this deliberate must not depend on an upstream
 *     minor release;
 *   - script direction for the 639-1 set, because `iso-639-1` carries none.
 *
 * Curated product POLICY does NOT live here — the language→flag map, the label
 * overrides and the non-sovereign Turkic regions stay in
 * `server/{languages,countries,regions}.ts`, where they are visible and
 * reviewable. This file is reference data the sources lack, nothing more.
 */

export type OverlayLanguageRow = readonly [code: string, native: string, english: string, rtl?: 1];
export type OverlayCountry = {
  iso2: string; iso3: string; name: string; native: string;
  currency: string[]; languages: string[];
};
export type OverlayDialing = {
  iso2: string; callingCode: string; leadingDigits?: string;
  nationalPrefix?: string; nsnLengths: number[]; exampleNumber?: string;
};

/** The Turkic ISO 639-3 languages the region seed requires. `1` = RTL script. */
export const EXTRA_LANGUAGES: readonly OverlayLanguageRow[] = [
  ['alt', 'Алтай тил', 'Altai'],
  ['azb', 'Güney Azərbaycan Türkcəsi', 'South Azerbaijani', 1],
  ['crh', 'Qırımtatar tili', 'Crimean Tatar'],
  ['gag', 'Gagauz dili', 'Gagauz'],
  ['kaa', 'Qaraqalpaq tili', 'Karakalpak'],
  ['kjh', 'Хакас тілі', 'Khakas'],
  ['kmz', 'Xorasan Türkçesi', 'Khorasani Turkic', 1],
  ['krc', 'Къарачай-малкъар тил', 'Karachay-Balkar'],
  ['qxq', 'Qaşqay dili', 'Qashqai', 1],
  ['sah', 'Саха тыла', 'Sakha'],
  ['tyv', 'Тыва дыл', 'Tuvan'],
];

/**
 * Right-to-left scripts among the ISO 639-1 languages (the 639-3 rows above
 * carry their own flag). `iso-639-1` has no direction data, so this rides here;
 * it is the exact set the previous data source declared.
 */
export const RTL_LANGS: readonly string[] = ['ae', 'ar', 'dv', 'fa', 'he', 'ks', 'ps', 'sd', 'ug', 'ur', 'yi'];

/** Countries ISO 3166 does not carry. */
export const EXTRA_COUNTRIES: readonly OverlayCountry[] = [
  {
    iso2: 'CT', iso3: 'CTR',
    name: 'Turkish Republic of Northern Cyprus',
    native: 'Kuzey Kıbrıs Türk Cumhuriyeti',
    currency: ['TRY'], languages: ['tr'],
  },
];

/** Political name pins, applied over whatever the source says. */
export const COUNTRY_NAME_OVERRIDES: Record<string, { name?: string; native?: string }> = {
  TR: { name: 'Türkiye' },
  CY: { name: 'Greek Cypriot Administration of Southern Cyprus', native: 'Güney Kıbrıs Rum Yönetimi' },
};

/** Dialing plans `libphonenumber-js` metadata does not carry. */
export const EXTRA_DIALING: readonly OverlayDialing[] = [
  { iso2: 'CT', callingCode: '90', leadingDigits: '392', nationalPrefix: '0', nsnLengths: [10], exampleNumber: '3921234567' },
  { iso2: 'GS', callingCode: '500', nsnLengths: [5], exampleNumber: '51234' },
  { iso2: 'PN', callingCode: '64', nationalPrefix: '0', nsnLengths: [8, 9, 10], exampleNumber: '211234567' },
  { iso2: 'TF', callingCode: '262', nationalPrefix: '0', nsnLengths: [9], exampleNumber: '692123456' },
  { iso2: 'UM', callingCode: '1', nationalPrefix: '1', nsnLengths: [10], exampleNumber: '2015550123' },
];

/** Offered even though no country references them (supranational units). */
export const CURRENCY_KEEP: readonly string[] = ['XDR', 'XSU'];

/** ISO 4217 fund/metal/test codes — never display currencies, even if referenced. */
export const CURRENCY_FUND_CODES: readonly string[] = [
  'BOV', 'CHE', 'CHW', 'CLF', 'COU', 'MXV', 'USN', 'USS', 'UYI', 'UYW',
  'XAD', 'XAG', 'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XPD', 'XPT', 'XTS', 'XUA', 'XXX',
];

/**
 * The TRNC flag — `country-flag-icons` covers every other code the catalogue
 * offers. Wrapper attributes are already applied; the generator still sanitizes
 * and safety-asserts it like every other flag.
 */
export const CT_FLAG_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="#e30a17"><path d="m0 0h900v600H0z" fill="#fff"/><circle cx="300" cy="300" r="150"/><circle cx="337.5" cy="300" r="120" fill="#fff"/><path d="M0 60h900v60H0zM0 480h900v60H0zM417.5 300l135.676275-44.083894-83.852549 115.413133v-142.658477l83.852549 115.413133z"/></svg>';
