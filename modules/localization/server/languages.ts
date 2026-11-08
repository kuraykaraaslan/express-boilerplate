// Languages reference data — rows via ./localization.source (the data seam), the
// policy on top of them here. Names and direction come from the committed
// projection (iso-639-1 + data/localization.overlay.ts); the full ISO 639-1 set
// is exposed — MINUS the deprecated subtags — plus the ISO 639-3 codes
// ./regions needs. EVERY language resolves to a flag (no flagless language):
// curated map → Turkic region flag → representative country → neutral.
// Pure/data — safe to import in client pages and server helpers.
import { rawLanguages, rawCountries } from './localization.source';
import type { LanguageInfo, FlagOption } from './types';

/** Back-compat alias for dynamic_page's original LocaleInfo shape. */
export type LocaleInfo = { code: string; label: string; rtl?: boolean; flag?: string };

// Curated language → ISO-3166 alpha-2 country for a flag (languages ≠ countries).
// Policy, not reference data: `en → GB` (not US), `ar → SA`, `la → VA` are product
// choices the source's own country links would answer differently. `lu → CD`
// pins Luba-Katanga to the DRC regardless of what the gap-fill happens to reach
// — it has fallen to the globe under a source refresh before.
const LANG_FLAG: Record<string, string> = {
  en: 'GB', tr: 'TR', de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', nl: 'NL',
  ru: 'RU', pl: 'PL', uk: 'UA', ro: 'RO', el: 'GR', cs: 'CZ', sk: 'SK', hu: 'HU',
  sv: 'SE', da: 'DK', fi: 'FI', no: 'NO', nb: 'NO', nn: 'NO', bg: 'BG', sr: 'RS',
  hr: 'HR', sl: 'SI', lt: 'LT', lv: 'LV', et: 'EE', is: 'IS', ga: 'IE', sq: 'AL',
  mk: 'MK', be: 'BY', ca: 'ES', eu: 'ES', gl: 'ES', bs: 'BA', mt: 'MT', lb: 'LU',
  cy: 'GB', gd: 'GB', br: 'FR', oc: 'FR', co: 'FR', fo: 'FO', fy: 'NL', rm: 'CH',
  ar: 'SA', he: 'IL', fa: 'IR', ur: 'PK', ps: 'AF', sd: 'PK', ug: 'CN', dv: 'MV',
  zh: 'CN', ja: 'JP', ko: 'KR', hi: 'IN', bn: 'BD', ta: 'IN', te: 'IN', ml: 'IN',
  kn: 'IN', mr: 'IN', gu: 'IN', pa: 'IN', or: 'IN', as: 'IN', sa: 'IN', ks: 'IN',
  ne: 'NP', si: 'LK', th: 'TH', vi: 'VN', id: 'ID', ms: 'MY', jv: 'ID', su: 'ID',
  tl: 'PH', my: 'MM', km: 'KH', lo: 'LA', bo: 'CN', dz: 'BT', mn: 'MN', kk: 'KZ',
  ky: 'KG', uz: 'UZ', tg: 'TJ', tk: 'TM', az: 'AZ', ka: 'GE', hy: 'AM', tt: 'RU',
  ba: 'RU', cv: 'RU', ce: 'RU', os: 'GE', ab: 'GE',
  sw: 'KE', am: 'ET', ti: 'ER', om: 'ET', so: 'SO', af: 'ZA', zu: 'ZA', xh: 'ZA',
  st: 'LS', tn: 'BW', ts: 'ZA', ss: 'SZ', ve: 'ZA', nr: 'ZA', sn: 'ZW', ny: 'MW',
  rw: 'RW', rn: 'BI', lg: 'UG', ki: 'KE', ln: 'CD', kg: 'CD', lu: 'CD', sg: 'CF', wo: 'SN',
  ff: 'SN', bm: 'ML', ee: 'GH', tw: 'GH', ak: 'GH', ha: 'NG', yo: 'NG', ig: 'NG',
  mg: 'MG', kl: 'GL', mi: 'NZ', sm: 'WS', to: 'TO', fj: 'FJ', ty: 'PF', ht: 'HT',
  qu: 'PE', ay: 'BO', gn: 'PY', la: 'VA',
  // Minority / regional / historical languages → a representative country.
  aa: 'ET', ae: 'IR', an: 'ES', av: 'RU', cr: 'CA', cu: 'RU', ho: 'PG', hz: 'NA',
  ii: 'CN', ik: 'US', iu: 'CA', kj: 'AO', kr: 'NG', kv: 'RU', kw: 'GB', li: 'NL',
  ng: 'NA', nv: 'US', oj: 'CA', pi: 'IN', sc: 'IT', se: 'NO', wa: 'BE', yi: 'IL', za: 'CN',
};

// Gap-fill: first country (in data order) that lists a language → its alpha-2.
const AUTO_LANG_FLAG: Record<string, string> = {};
for (const c of rawCountries()) for (const l of c.languages || []) if (!AUTO_LANG_FLAG[l]) AUTO_LANG_FLAG[l] = c.iso2;

/**
 * Every language gets a flag, and it is always one FlagIcon can actually draw.
 *
 * Constructed and auxiliary languages (Esperanto, Ido, Interlingua, Interlingue,
 * Volapük) have no country, so they take the neutral 'INT' globe.
 *
 * So do the eleven Turkic ISO 639-3 minority languages, for now. They used to map
 * to their region's flag — sah → SAKHA, crh → CRIMEAN_TATARS — but that artwork
 * is gone (unresolved Wikimedia licences), and a code with no artwork renders as
 * nothing (or as a bare text badge, in dynamic_page's LangFlag). The globe is
 * the honest placeholder. Restore the mapping when licensed region artwork
 * lands; the alternative — a sovereign flag for each — is not on the table,
 * because the Russian flag on Sakha says the opposite of what the entry exists
 * to say.
 */
function flagFor(code: string): string {
  return LANG_FLAG[code] || AUTO_LANG_FLAG[code] || 'INT';
}

// Script direction rides in the row (4th slot) — it is reference data, not
// product policy, and a hand-kept set HERE drifted from it silently. (The
// overlay records it for the 639-1 set because iso-639-1 carries no direction
// data; that is capture at the source, not policy in the catalogue.)
const RTL_SET = new Set(rawLanguages().filter((r) => r[3] === 1).map((r) => r[0]));

/**
 * Withdrawn ISO 639-1 subtags. `sh` (Serbo-Croatian) was withdrawn in 2000 and
 * its members `bs`/`hr`/`sr` are all offered separately, so it would be a fourth
 * control for the same set — and, since it carries no endonym and no country, it
 * would render in English behind the neutral globe. It is excluded here rather
 * than in the generator because it is a product call, not a data fact: keeping it
 * out is what holds `LanguageCodeEnum` at 194 codes, and widening a persisted
 * enum is easy while narrowing one later is not.
 */
const DEPRECATED_SUBTAGS = new Set(['sh']);

// Display endonyms, overriding the source's native name. `iso-639-1` records a few
// languages as their dictionary form, lowercase and with the word for "language"
// ("български език"), where every other common language carries the name a speaker
// would pick from a list ("Русский", "Türkçe"). The name is what a language picker
// and the apps' language list show, so the product's wording stays here, one line
// each, like the country LABEL_OVERRIDES.
const NATIVE_LABEL_OVERRIDES: Record<string, string> = {
  bg: 'Български', // source: "български език"
  sr: 'Српски', // source: "српски језик"
  mk: 'Македонски', // source: "македонски јазик"
};

// Common languages surface first; the rest follow alphabetically by English name.
const PREFERRED = ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'pl', 'uk', 'ar', 'zh', 'ja', 'ko', 'hi', 'id', 'th', 'vi'];
const rank = (c: string) => { const i = PREFERRED.indexOf(c); return i === -1 ? PREFERRED.length : i; };

// The rows already carry the Turkic ISO 639-3 minority languages the regions in
// ./regions speak — the generator asserts every seed code resolves (and the
// seed is typed CatalogueLanguageCode), so a region can never name a language
// this catalogue cannot.
export const LANGUAGES: LanguageInfo[] = rawLanguages()
  .filter(([code]) => !DEPRECATED_SUBTAGS.has(code))
  .map(([code, native, english]) => ({
    code,
    label: NATIVE_LABEL_OVERRIDES[code] || native || english || code,
    englishName: english || code,
    flag: flagFor(code),
    rtl: RTL_SET.has(code) || undefined,
  }))
  .sort((a, b) => rank(a.code) - rank(b.code) || a.englishName.localeCompare(b.englishName));

/** dynamic_page compatibility alias — same structural shape (`LocaleInfo`). */
export const LOCALE_CATALOGUE: LocaleInfo[] = LANGUAGES;

/** Options ready for the common FlagSelect / FlagMultiSelect. */
export const LANGUAGE_OPTIONS: FlagOption[] = LANGUAGES.map((l) => ({
  value: l.code,
  label: `${l.label} (${l.code})`,
  flag: l.flag,
}));

const FLAGS = new Map(LANGUAGES.filter((l) => l.flag).map((l) => [l.code, l.flag!]));
const LABELS = new Map(LANGUAGES.map((l) => [l.code, l.label]));
const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Base language subtag (`en-US` → `en`), lowercased. */
export function baseLang(lang: string): string {
  return (lang || '').toLowerCase().split('-')[0];
}

export function getLanguage(code: string): LanguageInfo | undefined {
  return BY_CODE.get(baseLang(code));
}

/**
 * ISO-3166 alpha-2 country code for a language's flag. Mapped entries win;
 * otherwise fall back to the region subtag (`pt-BR` → BR) or the uppercased
 * primary subtag. Callers still verify with `hasFlag` and fall back gracefully.
 */
export function flagCountry(lang: string): string {
  const base = baseLang(lang);
  if (FLAGS.has(base)) return FLAGS.get(base)!;
  const region = (lang || '').split('-')[1];
  if (region && region.length === 2) return region.toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function isRtlLang(lang: string): boolean {
  return RTL_SET.has(baseLang(lang));
}

export function localeLabel(code: string): string {
  return LABELS.get(baseLang(code)) ?? code.toUpperCase();
}

// Loose BCP-47-ish validation: 2–3 letter primary subtag + optional `-SUBTAG` parts.
const BCP47_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;
export function isValidLangCode(code: string): boolean {
  return BCP47_RE.test((code || '').trim());
}

/**
 * Narrow a language pool to an explicit `languages` allow-list — the deployment
 * saying "offer only these" (e.g. `['tr', 'en']`). Both sides are base-subtag
 * normalized (`en-US` → `en`) and the result keeps the ALLOW-LIST's order, so the
 * caller controls how the languages are presented. An empty/absent allow-list
 * means no restriction: the pool passes through unchanged.
 *
 * This only ever narrows. A language the pool does not contain cannot be added
 * back by listing it here — the pool is still the tenant's `enabledLanguages`.
 */
export function narrowLanguages(pool: string[], languages?: string[] | null): string[] {
  const available = new Set(pool.map(baseLang).filter(Boolean));
  if (!languages?.length) return [...available];
  const out: string[] = [];
  for (const raw of languages) {
    const code = baseLang(raw);
    if (code && available.has(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** Parse an enabled-languages CSV into an ordered, de-duped, lowercased list. */
export function parseEnabledLanguages(csv: string | null | undefined): string[] {
  if (!csv) return [];
  const out: string[] = [];
  for (const raw of csv.split(',')) {
    const code = raw.trim().toLowerCase();
    if (code && isValidLangCode(code) && !out.includes(code)) out.push(code);
  }
  return out;
}
