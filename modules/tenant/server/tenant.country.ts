import type { TenantRegion } from './entities/tenant.entity';

/**
 * A tenant's country (docs/phases/49-country-pricing, stage 49.1): ISO 3166-1 alpha-2, the key the price lists and the payment options of
 * phase 49 are looked up by. `region` (the six-way bloc) stays as the locale and presentation hint and is DERIVED from the country through
 * {@link regionForCountry}; data residency (`homeRegionId`, `residencyRequirement`) is a different question and is never touched here.
 */

/** Where the stored country came from: the operator's pick, the sign-up's geo-IP, the browser's language region, or the platform default. */
export const COUNTRY_SOURCES = ['operator', 'geoip', 'locale', 'default'] as const;
export type CountrySource = (typeof COUNTRY_SOURCES)[number];

/** The country a tenant gets when nothing says otherwise (owner answer 1, 2026-10-28). */
export const DEFAULT_COUNTRY_CODE = 'TR';

/** Every ISO 3166-1 alpha-2 code the platform accepts (the 249 officially assigned codes). */
export const COUNTRY_CODES: readonly string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
];

const COUNTRY_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

const REGION_COUNTRIES: Record<Exclude<TenantRegion, 'TR'>, readonly string[]> = {
  // The EU, the EEA, the United Kingdom, Switzerland and the rest of the continent's markets that buy in euro or follow the euro list.
  // Russia and Belarus are left out on purpose: they price from the "everywhere else" list.
  EU: [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    'IS', 'LI', 'NO', 'CH', 'GB', 'AD', 'MC', 'SM', 'VA', 'AL', 'BA', 'ME', 'MK', 'RS', 'MD', 'UA', 'GI', 'IM', 'JE', 'GG', 'FO', 'AX', 'SJ',
  ],
  US: ['US', 'CA', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM'],
  APAC: [
    'AU', 'NZ', 'JP', 'KR', 'CN', 'HK', 'MO', 'TW', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'IN', 'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'MM', 'KH', 'LA', 'BN', 'MN',
    'KZ', 'KG', 'TJ', 'TM', 'UZ', 'AF', 'TL', 'PG', 'FJ', 'NC', 'PF', 'WS', 'TO', 'VU', 'SB', 'KI', 'FM', 'MH', 'NR', 'PW', 'TV', 'CK', 'NU', 'TK', 'WF',
  ],
  LATAM: [
    'MX', 'GT', 'BZ', 'HN', 'SV', 'NI', 'CR', 'PA', 'CU', 'DO', 'HT', 'JM', 'TT', 'BB', 'BS', 'AG', 'DM', 'GD', 'KN', 'LC', 'VC', 'AW', 'CW', 'SX', 'BQ',
    'CO', 'VE', 'GY', 'SR', 'EC', 'PE', 'BR', 'BO', 'PY', 'UY', 'AR', 'CL', 'GF', 'GP', 'MQ', 'BL', 'MF', 'PM', 'AI', 'BM', 'KY', 'MS', 'TC', 'VG', 'FK',
  ],
  MEA: [
    'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'YE', 'IQ', 'IR', 'JO', 'LB', 'SY', 'IL', 'PS', 'AZ', 'AM', 'GE',
    'EG', 'LY', 'TN', 'DZ', 'MA', 'EH', 'SD', 'SS', 'ET', 'ER', 'DJ', 'SO', 'KE', 'UG', 'TZ', 'RW', 'BI', 'CD', 'CG', 'CF', 'CM', 'GQ', 'GA', 'ST',
    'NG', 'GH', 'CI', 'SN', 'ML', 'BF', 'NE', 'TD', 'MR', 'GM', 'GN', 'GW', 'SL', 'LR', 'TG', 'BJ', 'CV',
    'ZA', 'NA', 'BW', 'ZW', 'ZM', 'MW', 'MZ', 'AO', 'LS', 'SZ', 'MG', 'MU', 'SC', 'KM', 'RE', 'YT', 'SH',
  ],
};

const COUNTRY_REGION: ReadonlyMap<string, TenantRegion> = new Map([
  ['TR', 'TR' as TenantRegion],
  ...(Object.entries(REGION_COUNTRIES) as [TenantRegion, readonly string[]][]).flatMap(([region, list]) => list.map((c): [string, TenantRegion] => [c, region])),
]);

/** `value` as an ISO alpha-2 code (trimmed, upper case), or null when it is not an assigned one. */
export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return COUNTRY_SET.has(code) ? code : null;
}

/** The bloc a country belongs to (`TR` for Turkey, `EU`, `US`, `APAC`, `LATAM`, `MEA`), or null for a country no bloc lists (Russia, Belarus, Antarctica ...). */
export function regionForCountry(countryCode: string | null | undefined): TenantRegion | null {
  const code = normalizeCountryCode(countryCode);
  return code ? (COUNTRY_REGION.get(code) ?? null) : null;
}

/**
 * The price and payment-option scopes of a tenant, most specific first: its country, its bloc, then `'*'` (every other country). A row with a
 * tenant that has no country yet (a tenant from before phase 49) starts from its own `region` instead, which is what the price lookup did
 * before the country existed. Duplicates collapse (Turkey is both the country `TR` and the bloc `TR`).
 */
export function scopeChain(countryCode: string | null | undefined, region?: string | null): string[] {
  const country = normalizeCountryCode(countryCode);
  const bloc = country ? regionForCountry(country) : (typeof region === 'string' && region.trim() ? region.trim() : null);
  return [...new Set([country, bloc, '*'].filter((s): s is string => !!s))];
}

/**
 * The region of an `Accept-Language` header's BEST-ranked tag (`tr-TR,tr;q=0.9,en;q=0.8` -> `TR`), or null when that tag names none. Only the top
 * tag counts: `tr,en-US;q=0.7` is a Turkish speaker who also reads English, not a person in the United States, so a region-less first choice
 * gives no country (the platform default applies) instead of the region of a lower-ranked language.
 */
export function countryFromAcceptLanguage(header: string | null | undefined): string | null {
  if (!header) return null;
  const tags = header.split(',').map((part, index) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const weight = q ? Number(q.slice(2)) : 1;
    return { tag: tag.trim(), weight: Number.isFinite(weight) ? weight : 0, index };
  }).filter((t) => t.tag && t.weight > 0).sort((a, b) => b.weight - a.weight || a.index - b.index);
  if (!tags.length) return null;
  const region = tags[0].tag.split('-').slice(1).find((sub) => /^[A-Za-z]{2}$/.test(sub));
  return normalizeCountryCode(region);
}

export interface DetectedCountry { countryCode: string; source: CountrySource }

/**
 * The country of a new sign-up, silently (owner answer 1): the request's geo-IP, else the browser language's region, else the platform default.
 * `lookup` is the geo provider (injected so a test needs no network); a failing or slow lookup is not an error, it falls through to the next source.
 */
export async function detectSignupCountry(
  hints: { ip?: string | null; acceptLanguage?: string | null },
  lookup: (ip: string) => Promise<string | null | undefined>,
): Promise<DetectedCountry> {
  if (hints.ip) {
    try {
      const code = normalizeCountryCode(await lookup(hints.ip));
      if (code) return { countryCode: code, source: 'geoip' };
    } catch { /* no geo answer: the next source */ }
  }
  const fromLanguage = countryFromAcceptLanguage(hints.acceptLanguage);
  if (fromLanguage) return { countryCode: fromLanguage, source: 'locale' };
  return { countryCode: DEFAULT_COUNTRY_CODE, source: 'default' };
}

/**
 * The country fields of a tenant the OPERATOR creates: the country it picked (source 'operator'); with none, a `region` it named keeps the
 * tenant country-less (it prices from that region, as before); with neither, the platform default TR (source 'default').
 */
export function operatorCreateCountry(body: { countryCode?: string | null; region?: string | null }): { countryCode?: string; countrySource?: CountrySource } {
  if (body.countryCode) return { countryCode: body.countryCode, countrySource: 'operator' };
  if (body.region) return {};
  return { countryCode: DEFAULT_COUNTRY_CODE, countrySource: 'default' };
}
