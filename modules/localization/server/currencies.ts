// Currencies reference data — rows via ./localization.source (the data seam;
// ISO 4217 codes with names/symbols + a representative country for the flag).
// Self-contained: no Intl / countries-list at runtime.
import { rawCurrencies } from './localization.source';
import type { CurrencyInfo, FlagOption } from './types';

export const CURRENCIES: CurrencyInfo[] = rawCurrencies()
  .map((c) => ({ code: c.code, label: c.name, symbol: c.symbol, flag: c.country || undefined }))
  .sort((a, b) => a.label.localeCompare(b.label));

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): CurrencyInfo | undefined {
  return BY_CODE.get((code || '').toUpperCase());
}

/** Options for the common FlagSelect / FlagMultiSelect. */
export const CURRENCY_OPTIONS: FlagOption[] = CURRENCIES.map((c) => ({
  value: c.code,
  label: `${c.label} (${c.code})`,
  flag: c.flag,
}));
