/**
 * The unit of the heartbeat `billing` block's `mrrMinor` (plan-catalog.ts, Decision 20): an integer in the MINOR unit of the row's
 * own `currency`, with the ISO 4217 exponent of that currency. 49.00 EUR is 4900, 5000 JPY is 5000, 1.234 KWD is 1234. It is NOT
 * "hundredths for every currency": a region that multiplied by 100 reported a JPY plan at a hundred times its price and a KWD one at
 * a tenth, and a console that divided by 100 showed them back the same wrong way.
 *
 * The region converts with the payment host's table (payment.currency.ts `majorToMinorUnits`); this file is the same table for the
 * readers of the wire (the control-plane console), with no imports so a browser bundle can use it. A parity test pins the two.
 * `XXX` (ISO "no currency", a product without a retail price) counts as 2 digits; its MRR is always 0.
 *
 * Keep this file free of imports.
 */

/** ISO 4217 currencies with 0 minor digits. */
export const BILLING_ZERO_DECIMAL_CURRENCIES: readonly string[] = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
/** ISO 4217 currencies with 3 minor digits. */
export const BILLING_THREE_DECIMAL_CURRENCIES: readonly string[] = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];
/** ISO 4217 currencies with 4 minor digits. */
export const BILLING_FOUR_DECIMAL_CURRENCIES: readonly string[] = ['CLF', 'UYW'];

/** Minor digits of a billing row's currency, any case (JPY 0, EUR 2, KWD 3, CLF 4; every unlisted code 2). */
export function billingCurrencyExponent(currency: string): 0 | 2 | 3 | 4 {
  const c = String(currency || '').toUpperCase();
  if (BILLING_ZERO_DECIMAL_CURRENCIES.includes(c)) return 0;
  if (BILLING_THREE_DECIMAL_CURRENCIES.includes(c)) return 3;
  return BILLING_FOUR_DECIMAL_CURRENCIES.includes(c) ? 4 : 2;
}

/** An `mrrMinor` as an exact decimal string of its currency: 4900 EUR -> "49.00", 5000 JPY -> "5000", 1234 KWD -> "1.234". */
export function billingMinorToDecimalString(minor: number, currency: string): string {
  const n = Number.isSafeInteger(minor) ? minor : 0;
  const digits = billingCurrencyExponent(currency);
  const negative = n < 0;
  const raw = String(Math.abs(n));
  if (digits === 0) return `${negative ? '-' : ''}${raw}`;
  const padded = raw.padStart(digits + 1, '0');
  return `${negative ? '-' : ''}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
