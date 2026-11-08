import { z } from 'zod';
import { code as isoCurrencyRecord } from 'currency-codes-ts';
import { AppError, ErrorCode } from './app-error';
import { CurrencyCodeEnum, type CurrencyCode } from './common.currency';
// The leaf, not common.locale: that file loads the IANA language registry just to validate tags.
import { DEFAULT_LOCALE, type LocaleCode } from './common.locale-default';
import { currencyDecimals } from './common.money-format';

/**
 * Money value object: an amount paired with its ISO 4217 currency, so the two
 * never drift apart in arithmetic. Arithmetic across mismatched currencies is a
 * `CURRENCY_MISMATCH` error rather than a silent wrong total. Formatting defers
 * to `Intl.NumberFormat`, which knows each currency's minor units (JPY 0, KWD 3).
 *
 * Dependency-free: depends only on sibling `common` primitives.
 */
/** common.19: the decimals of an amount as written (`0.1` → 1, `1e-7` → 7). */
function decimalPlaces(n: number): number {
  const [mantissa, exp] = String(n).toLowerCase().split('e');
  const frac = (mantissa!.split('.')[1] ?? '').length;
  return Math.max(0, frac - Number(exp ?? 0));
}

/** common.19: an amount is finite and a whole number of its currency's minor units (0.001 USD cannot be held). */
export const MoneySchema = z.object({
  amount: z.number().finite(),
  currency: CurrencyCodeEnum,
}).refine((m) => decimalPlaces(m.amount) <= currencyDecimals(m.currency), { message: 'Amount has more decimals than the currency holds', path: ['amount'] });

export type Money = z.infer<typeof MoneySchema>;

/** Construct a `Money`. */
export function money(amount: number, currency: CurrencyCode): Money {
  return { amount, currency };
}

/** Locale-aware currency string, e.g. `$1,234.50`, `￥1,235`, `₺1.234,50`. */
export function formatMoney(m: Money, locale?: LocaleCode | string): string {
  return new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, {
    style: 'currency',
    currency: m.currency,
  }).format(m.amount);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new AppError(
      `Cannot operate on mismatched currencies: ${a.currency} vs ${b.currency}`,
      422,
      ErrorCode.CURRENCY_MISMATCH,
    );
  }
}

/** Add two same-currency amounts; throws `CURRENCY_MISMATCH` (422) otherwise. */
/**
 * common.19: `a op b` computed exactly on a common decimal scale (the currency's own decimals, or more when an operand carries
 * more), so 0.1 + 0.2 is 0.3 and not 0.30000000000000004.
 */
function exactSum(a: number, b: number, sign: 1 | -1, currency: string): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new AppError('Money amounts must be finite', 422, ErrorCode.VALIDATION_ERROR);
  const scale = Math.min(12, Math.max(currencyDecimals(currency), decimalPlaces(a), decimalPlaces(b)));
  const f = 10 ** scale;
  return (Math.round(a * f) + sign * Math.round(b * f)) / f;
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: exactSum(a.amount, b.amount, 1, a.currency), currency: a.currency };
}

/** Subtract `b` from `a` (same currency); throws `CURRENCY_MISMATCH` (422) otherwise. */
export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: exactSum(a.amount, b.amount, -1, a.currency), currency: a.currency };
}

/** Scale an amount by a unitless factor, preserving the currency. */
export function multiplyMoney(m: Money, factor: number): Money {
  // common.19: NaN or Infinity would poison every total it reaches without a trace.
  if (!Number.isFinite(factor) || !Number.isFinite(m.amount)) throw new AppError('Money factor must be finite', 422, ErrorCode.VALIDATION_ERROR);
  return { amount: m.amount * factor, currency: m.currency };
}


// ─── Minor units ─────────────────────────────────────────────────────────────
// The string side of money lives in common.money-format so client bundles can
// import it without this file's zod and currency-code dependencies.
export {
  MINOR_RE,
  minorUnitDigits,
  minorToDecimalString,
  formatMinor,
  decimalToMinor,
  currencyDecimals,
} from './common.money-format';

/**
 * ISO-4217 minor-unit digits — the STORAGE exponent.
 *
 * This is the scale commerce's bigint columns are written with (migration
 * `039_commerce_money_minor_units.sql` — `money.scale-parity.test.ts` pins the
 * two against each other). It is sourced from `currency-codes-ts`, the same
 * package `CurrencyCodeEnum` is built from, so storage never re-scales under a
 * Node/ICU upgrade the way CLDR-derived digits can.
 *
 * It deliberately DISAGREES with the other two digit sources (common.money-format):
 * `currencyDecimals` says HUF=0 (tax.rounding.ts's set) and CLDR says IQD=0;
 * ISO says HUF=2 and IQD=3. Storage follows ISO — the divergence is recorded
 * debt (docs/phases/04-commerce/08 §2.2), not an accident to "fix" silently.
 */
export function isoMinorUnitDigits(currency: string): number {
  return isoCurrencyRecord((currency || 'USD').toUpperCase() as CurrencyCode)?.digits ?? 2;
}
