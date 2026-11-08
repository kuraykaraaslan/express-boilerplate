import { currencyDecimals } from './common.money-format';
import { AppError, ErrorCode } from './app-error';

/**
 * Exact money arithmetic in integer MINOR units, using BigInt end to end — no
 * float ever touches an amount. This is the one engine every domain (invoice,
 * tax, cart, order, payment, subscription, …) computes through, so a total is
 * produced the same way wherever it is produced.
 *
 * Amounts are minor-unit strings (`"123456"` = 1234.56 in a 2-dp currency);
 * quantities and percentages are decimal strings (`"12.5"`, `"18"`). The rounding
 * primitive is `divRoundMinor`; everything else is built on it.
 *
 * Generalised from the quote engine (`modules/quote/server/quote.calc.ts`), whose
 * `roundMinor(value:number,…)` did the final rounding in float. Here the rounding
 * is on BigInt (`2·(num mod den)` vs `den` for the half tie), so nothing is lost.
 */

export type RoundingMode = 'half-up' | 'half-even';

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function pow10(n: number): bigint {
  let r = ONE;
  for (let i = 0; i < n; i++) r *= BigInt(10);
  return r;
}

/**
 * Round `numerator / denominator` to the nearest integer minor unit.
 * THE rounding primitive — half-up (commercial) or half-even (banker's).
 * Exact on BigInt: no epsilon, no float.
 */
export function divRoundMinor(numerator: bigint, denominator: bigint, mode: RoundingMode = 'half-up'): bigint {
  if (denominator === ZERO) throw new AppError('Division by zero in money math', 500, ErrorCode.INTERNAL_ERROR);
  const negDen = denominator < ZERO;
  let num = negDen ? -numerator : numerator;
  const den = negDen ? -denominator : denominator;

  const negative = num < ZERO;
  if (negative) num = -num;

  const q = num / den;
  const rem = num % den;
  const twiceRem = rem * TWO;

  let rounded: bigint;
  if (twiceRem > den) {
    rounded = q + ONE;
  } else if (twiceRem < den) {
    rounded = q;
  } else if (mode === 'half-even') {
    rounded = (q % TWO === ZERO) ? q : q + ONE;
  } else {
    rounded = q + ONE; // half-up
  }
  return negative ? -rounded : rounded;
}

/** Parse a decimal string (`"12.5"`, `"-3,25"`) to an integer scaled by 10^scale. */
/**
 * common.41: a minor-unit amount as a bigint, or a typed 422. An empty or missing amount is 0 (the documented default); a
 * string must be an optional sign and ASCII digits. Garbage used to reach `BigInt()` and escape as a raw SyntaxError (a 500).
 */
function toMinorBigInt(v: string | number | bigint | null | undefined): bigint {
  if (typeof v === 'bigint') return v;
  if (v === null || v === undefined || v === '') return ZERO;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  throw new AppError('Invalid minor-unit amount', 422, ErrorCode.VALIDATION_ERROR);
}

function decimalToScaledBigInt(value: string | number | null | undefined, scale: number): bigint {
  if (value == null || value === '') return ZERO;
  const str = String(value).trim().replace(',', '.');
  const negative = str.startsWith('-');
  const body = negative ? str.slice(1) : str;
  const [wholeRaw = '0', fracRaw = ''] = body.split('.');
  const whole = wholeRaw.replace(/\D/g, '') || '0';
  // Round the fraction at `scale` digits so quantities finer than the scale are
  // handled deterministically (half-up on the raw digits).
  const fracDigits = fracRaw.replace(/\D/g, '');
  const kept = fracDigits.slice(0, scale).padEnd(scale, '0');
  const nextDigit = fracDigits.charCodeAt(scale) - 48; // NaN → negative → no round-up
  let scaled = BigInt(whole) * pow10(scale) + BigInt(kept || '0');
  if (nextDigit >= 5) scaled += ONE;
  return negative ? -scaled : scaled;
}

const QTY_SCALE = 4;   // numeric(14,4) quantities
const PCT_SCALE = 4;   // percentages carried to 4 dp (e.g. 33.3333)

/**
 * Exact price × decimal-quantity → minor units.
 * `priceMinor` is a minor-unit integer string; `quantity` is a numeric(14,4)
 * string. Computed as `round(qtyScaled · priceMinor / 10^4)` in BigInt so a large
 * quantity of a high-priced item cannot silently lose a digit the way a float
 * `Number(qty)*Number(price)` would past 2^53.
 */
export function mulMinorByQuantity(priceMinor: string | bigint, quantity: string | number, mode: RoundingMode = 'half-up'): bigint {
  const price = typeof priceMinor === 'bigint' ? priceMinor : toMinorBigInt(priceMinor);
  const qtyScaled = decimalToScaledBigInt(quantity ?? '1', QTY_SCALE);
  return divRoundMinor(price * qtyScaled, pow10(QTY_SCALE), mode);
}

/**
 * `percent` of a minor-unit base, exact. `percent` is a decimal string/number
 * (`"18"`, `"33.3333"`). Computed as `round(base · pctScaled / 10^(PCT_SCALE+2))`.
 */
export function pctOfMinor(baseMinor: string | bigint, percent: string | number | null | undefined, mode: RoundingMode = 'half-up'): bigint {
  const base = typeof baseMinor === 'bigint' ? baseMinor : toMinorBigInt(baseMinor);
  const pctScaled = decimalToScaledBigInt(percent ?? '0', PCT_SCALE);
  return divRoundMinor(base * pctScaled, pow10(PCT_SCALE + 2), mode);
}

// ─── Per-line calculation (gross → discount → net → tax → total) ──────────────

export interface LineCalcInput {
  /** numeric(14,4) as a string; default "1". */
  quantity?: string | number | null;
  /** unit price in minor units (integer string). */
  unitPriceMinor?: string | null;
  /** 0–100. Mutually exclusive with `discountMinor`. */
  discountPercent?: string | number | null;
  /** absolute discount in minor units. */
  discountMinor?: string | null;
  /** EFFECTIVE tax percent (compound rates already summed), e.g. "18". */
  taxRate?: string | number | null;
}

export interface LineCalcOutput {
  grossMinor: string;
  discountMinor: string;
  netMinor: string;
  taxMinor: string;
  lineTotalMinor: string;
}

/**
 * One line's numbers in the ONE order they may be computed: gross → discount →
 * net → tax → total. Taxing before discounting would charge tax on money the
 * customer never paid. Every value is a whole minor unit.
 */
export function calcLineMinor(input: LineCalcInput, mode: RoundingMode = 'half-up'): LineCalcOutput {
  const grossMinor = mulMinorByQuantity(input.unitPriceMinor ?? '0', input.quantity ?? '1', mode);

  let discountMinor: bigint;
  if (input.discountPercent != null && input.discountPercent !== '') {
    discountMinor = pctOfMinor(grossMinor, input.discountPercent, mode);
  } else {
    discountMinor = toMinorBigInt(input.discountMinor);
  }

  const netMinor = grossMinor - discountMinor;                 // integer subtraction
  const taxMinor = pctOfMinor(netMinor, input.taxRate ?? '0', mode);
  const lineTotalMinor = netMinor + taxMinor;                  // integer addition

  return {
    grossMinor: grossMinor.toString(),
    discountMinor: discountMinor.toString(),
    netMinor: netMinor.toString(),
    taxMinor: taxMinor.toString(),
    lineTotalMinor: lineTotalMinor.toString(),
  };
}

// ─── Aggregation (currency-safe) ─────────────────────────────────────────────

/** Sum minor-unit values (integer addition — nothing to round). */
export function sumMinor(values: Array<string | bigint>): bigint {
  return values.reduce<bigint>((s, v) => s + toMinorBigInt(v), ZERO);
}

/** Header totals = the exact SUM of the lines, never re-derived from them. */
export function sumLineTotals(lines: LineCalcOutput[]): {
  subtotalMinor: string; discountMinor: string; taxMinor: string; totalMinor: string;
} {
  let subtotal = ZERO, discount = ZERO, tax = ZERO;
  for (const l of lines) {
    subtotal += BigInt(l.netMinor);
    discount += BigInt(l.discountMinor);
    tax += BigInt(l.taxMinor);
  }
  return {
    subtotalMinor: subtotal.toString(),
    discountMinor: discount.toString(),
    taxMinor: tax.toString(),
    totalMinor: (subtotal + tax).toString(),
  };
}

/**
 * The ONLY blessed cross-row aggregator when rows may carry different currencies.
 * Returns a per-currency total, so adding TRY to USD is impossible by construction
 * (the class of bug that migration 033 documents). A caller that truly needs one
 * scalar must assert a single currency first — see `assertSingleCurrency`.
 */
export function sumMinorByCurrency(rows: Array<{ amountMinor: string | bigint; currency: string }>): Record<string, string> {
  const totals: Record<string, bigint> = {};
  for (const r of rows) {
    const cur = (r.currency || 'USD').toUpperCase();
    const amt = toMinorBigInt(r.amountMinor);
    totals[cur] = (totals[cur] ?? ZERO) + amt;
  }
  return Object.fromEntries(Object.entries(totals).map(([c, v]) => [c, v.toString()]));
}

/**
 * Assert every row shares one currency (a cart/order/invoice is single-currency).
 * Throws CURRENCY_MISMATCH rather than silently summing lira into dollars.
 */
export function assertSingleCurrency(currencies: string[], context = 'amounts'): string {
  const seen = new Set(currencies.map((c) => (c || '').toUpperCase()).filter(Boolean));
  if (seen.size > 1) {
    throw new AppError(`Mixed currencies in ${context}: ${[...seen].join(', ')}`, 422, ErrorCode.CURRENCY_MISMATCH);
  }
  return [...seen][0] ?? 'USD';
}

export { currencyDecimals };
