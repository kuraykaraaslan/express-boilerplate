import { z } from 'zod';
import { SOVEREIGN_ALPHA2, COUNTRY_NAMES, REGION_ALPHA2 } from './common.codes.generated';

/**
 * Country primitives — ISO 3166-1 alpha-2, **sovereign countries only**.
 *
 * Single-sourced from `modules/localization` through build-time codegen
 * (`npm run gen:localization-codes`). Before DUP-05 this file derived its own
 * list straight from the `countries-list` package while every picker in the
 * admin rendered localization's list, so the two disagreed on exactly the
 * entries that matter here: the Turkic regions exist in the picker but have no
 * ISO alpha-2 code, and picking one returned 400 from the tax-rate endpoint.
 * (Northern Cyprus was the flagship case and is no longer a region at all — the
 * data source carries the TRNC as the country `CT`, so it is in the enum.)
 * There is now one list, and the split is explicit:
 *
 *  - `CountryCodeEnum` / `CountryCodeInput` — sovereign ISO only. Use at every
 *    DTO boundary that persists a country as an ISO code (tax, shipping,
 *    invoicing, addresses).
 *  - `REGION_PSEUDO_CODES` — the non-ISO region codes, exported so a caller can
 *    *recognise* one and give a real error instead of a bare "invalid enum".
 *    Never widen a fiscal DTO with them; region-aware fields (audience
 *    targeting, display) should validate as free strings against
 *    localization's own catalogue.
 */
type CountryName = { name: string; native: string };

const COUNTRY_CODES = SOVEREIGN_ALPHA2 as unknown as [string, ...string[]];
const COUNTRY_DATA = COUNTRY_NAMES as Record<string, CountryName>;

export const CountryCodeEnum = z.enum(COUNTRY_CODES);
export type CountryCode = z.infer<typeof CountryCodeEnum>;

export const COUNTRIES: { code: CountryCode; name: string; native: string }[] =
  COUNTRY_CODES.map((code) => ({
    code: code as CountryCode,
    name: COUNTRY_DATA[code]?.name ?? code,
    native: COUNTRY_DATA[code]?.native ?? code,
  }));

/**
 * Non-sovereign pseudo "alpha-2" codes (the Turkic regions and peoples). Present
 * in localization's display catalogue, deliberately absent from `CountryCodeEnum`.
 */
export const REGION_PSEUDO_CODES: readonly string[] = REGION_ALPHA2;

/** True if `v` is a known sovereign ISO 3166-1 alpha-2 country code. */
export function isCountryCode(v: string): v is CountryCode {
  return Object.prototype.hasOwnProperty.call(COUNTRY_DATA, v);
}

/** True if `v` is one of localization's non-ISO region pseudo-codes. */
export function isRegionPseudoCode(v: string): boolean {
  return REGION_ALPHA2.includes(v as (typeof REGION_ALPHA2)[number]);
}

/**
 * ISO 3166-1 alpha-2 country code as received at an input boundary. Accepts
 * mixed-case input (`tr` / `Tr`) by upper-casing before validation, matching
 * the persistence layer which stores the upper-cased form. Use this at every
 * DTO / request boundary so the whole platform validates country the same way.
 */
export const CountryCodeInput = z.preprocess(
  (v) => (typeof v === 'string' ? v.toUpperCase() : v),
  CountryCodeEnum,
);
