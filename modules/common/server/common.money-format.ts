/**
 * Client-safe money formatting: minor-unit strings and currency digits, on
 * `Intl` alone.
 *
 * Split out of `common.money` so a browser bundle that only formats prices (the
 * storefront blocks on every public page) does not pull in zod, currency-codes-ts
 * and, through `common.locale`, the 1.6 MB IANA language registry.
 * `common.money` re-exports everything here, so server code keeps one import.
 *
 * Keep this file free of imports: anything added here ships to the public site.
 */

// ─── Minor units ─────────────────────────────────────────────────────────────

/**
 * The STRING side of money, for values that must not be rounded.
 *
 * `Money` in common.money holds a JavaScript number, which is right for a price a user
 * typed and wrong for a total pulled out of the database: a stored amount
 * crosses the wire as a string of MINOR units (`"1234567"`) precisely so that
 * nothing between Postgres and the screen has to represent it as a float.
 * These helpers keep it a string end to end.
 *
 * Two mistakes they exist to prevent:
 *
 *  1. dividing by 100 rounds. Above 2^53 minor units a float silently loses the
 *     last digits, and a CRM that rounds the number on the deal page is worse
 *     than one that shows nothing;
 *  2. dividing by 100 assumes two decimal places. JPY has none and KWD has
 *     three, so it shows a Japanese deal at one hundredth of its value.
 *
 * Both are avoided by asking Intl how many digits the currency actually has and
 * by handing Intl the decimal STRING, which it formats exactly.
 */

/** Digit-string shape of a stored minor-unit amount (bigint over the wire). */
export const MINOR_RE = /^-?\d+$/;

/** Decimal places for a currency, straight from the runtime's CLDR data. */
/**
 * Minor-unit digits for display and for typed amounts. common.18 (decided 2026-10-20): the SAME table as `currencyDecimals`
 * (ISO 4217), not the runtime's ICU data, so display, parsing and arithmetic can never disagree again (ICU reads IQD as 0
 * and HUF as 0; ISO says 3 and 2). `locale` no longer changes the digits; it is kept for the callers' signature.
 */
export function minorUnitDigits(currency: string, _locale?: string): number {
  return currencyDecimals(currency);
}

/** `"1234567"` + `TRY` → `"12345.67"`. Exact: no float is involved. */
export function minorToDecimalString(minor: string, currency: string, locale?: string): string {
  const negative = minor.startsWith('-');
  const raw = (negative ? minor.slice(1) : minor).replace(/\D/g, '') || '0';
  const digits = minorUnitDigits(currency, locale);
  if (digits === 0) return `${negative ? '-' : ''}${raw.replace(/^0+(?=\d)/, '')}`;

  const padded = raw.padStart(digits + 1, '0');
  const whole = padded.slice(0, -digits).replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${whole}.${padded.slice(-digits)}`;
}

/** `"1234567"` + `TRY` → `"₺12.345,67"` in a Turkish locale. */
export function formatMinor(minor: string, currency: string, locale?: string): string {
  const decimal = minorToDecimalString(minor, currency, locale);
  try {
    const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
    // Intl.NumberFormat#format accepts a decimal STRING and formats it exactly
    // (ES2023). The cast is only because TypeScript's lib types still declare
    // the parameter as `number | bigint`; passing a number here is precisely
    // the rounding this module exists to avoid, so the runtime behaviour — not
    // the stale type — is what we want.
    return (formatter.format as unknown as (value: string) => string)(decimal);
  } catch {
    return `${decimal} ${currency}`;
  }
}

/**
 * What a person typed → the minor-unit string the API wants.
 *
 * Accepts both `,` and `.` as the decimal mark, because a Turkish user types
 * `1234,56` and a form that rejects it is a form that is wrong about its user.
 * Extra fraction digits are truncated rather than rounded: rounding somebody's
 * typed amount UP without telling them is not a rounding decision to make on
 * their behalf.
 */
function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The grouping and decimal marks of a locale, or null when the locale is unknown. */
function localeMarks(locale: string): { group: string; decimal: string } | null {
  try {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(11111.1);
    const group = parts.find((p) => p.type === 'group')?.value;
    const decimal = parts.find((p) => p.type === 'decimal')?.value;
    return group && decimal ? { group, decimal } : null;
  } catch {
    return null;
  }
}

/**
 * The whole and fraction digits of a typed amount, or null when it is not one. Strict (common.37 / common.39): a plain number
 * with at most one `.` or `,` as the decimal mark, or (common.38) the number exactly as the given locale formats it, with its
 * grouping marks in the right places. Anything else (exponents, hex, thousands marks without a locale, letters, a second sign,
 * non-ASCII digits) is not guessed into an amount.
 */
function splitTypedAmount(body: string, locale?: string): { whole: string; frac: string } | null {
  // With a locale, its own grouped form first: in en-US "1,234" is a thousand and two hundred, not 1.234.
  const marks = locale ? localeMarks(locale) : null;
  if (marks) {
    const g = escapeRe(marks.group);
    const d = escapeRe(marks.decimal);
    const grouped = new RegExp(`^(\\d{1,3}(?:${g}\\d{3})+)(?:${d}(\\d*))?$`).exec(body);
    if (grouped) return { whole: grouped[1]!.split(marks.group).join(''), frac: grouped[2] ?? '' };
  }
  const plain = /^(\d*)(?:[.,](\d*))?$/.exec(body);
  if (plain && /\d/.test(body)) return { whole: plain[1]!, frac: plain[2] ?? '' };
  return null;
}

export function decimalToMinor(input: string, currency: string, locale?: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '0';

  const negative = trimmed.startsWith('-');
  const parsed = splitTypedAmount(negative ? trimmed.slice(1) : trimmed, locale);
  if (!parsed) throw new Error(`Not an amount: ${JSON.stringify(trimmed.slice(0, 40))}`);
  const digits = minorUnitDigits(currency, locale);

  const wholeDigits = parsed.whole || '0';
  const fracDigits = digits === 0 ? '' : parsed.frac.padEnd(digits, '0').slice(0, digits);
  const combined = `${wholeDigits}${fracDigits}`.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${combined}`;
}

// ─── Canonical minor-unit exponents (deterministic, ICU-independent) ──────────

/**
 * Currencies with ZERO minor-unit digits (whole units only).
 * The explicit set is the source of truth for ARITHMETIC — it must match the
 * DB's implied scale and stay stable across Node ICU builds, unlike the
 * runtime-CLDR `minorUnitDigits` (which is kept for DISPLAY). A unit test asserts
 * the two agree for the app's currency set.
 */
// common.18 / common.40 (decided 2026-10-20): ONE table, equal to ISO 4217 for every non-fund currency. HUF is 2 (it was 0 here
// and 2 in the display table), UYI and VUV are 0, CLF and UYW are 4. The data migrations `NNN_iso_minor_units.sql` of every
// module that stores minor units rescaled the one stored difference (IQD, read as 0 decimals by ICU before).
const ZERO_DECIMAL_CURRENCIES = new Set([
  'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XOF', 'XAF', 'BIF', 'PYG', 'RWF', 'UGX', 'XPF', 'GNF', 'KMF', 'DJF', 'UYI', 'VUV',
]);

/** Currencies with THREE minor-unit digits (the dinar family). */
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Currencies with FOUR minor-unit digits (index units). */
const FOUR_DECIMAL_CURRENCIES = new Set(['CLF', 'UYW']);

/**
 * Minor-unit digits for a currency — the CANONICAL arithmetic source (explicit
 * sets, deterministic). Use this everywhere money is computed or scaled; use
 * `minorUnitDigits` (Intl) only for locale-aware display.
 */
export function currencyDecimals(currency: string): number {
  const c = (currency || 'USD').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  if (FOUR_DECIMAL_CURRENCIES.has(c)) return 4;
  return 2;
}
