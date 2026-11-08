import SettingService from './tenant_setting.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { getDialing } from '@kuraykaraaslan-labs/localization/server/countries';

/**
 * THE tenant's country — where this workspace operates.
 *
 * ## Why there is exactly one of these
 *
 * There used to be five, all answering the same question and all defaulting to
 * `TR`:
 *
 * | key | what it decided |
 * |---|---|
 * | `telephonyDefaultRegion` | how to parse `0532 123 45 67` |
 * | `hrDefaultCountryCode` | which national-id validator runs; default nationality |
 * | `calendarDefaultCountry` | which public holidays get seeded |
 * | `legalTrDefaultCountryCode` | nothing — declared and never read |
 * | `defaultCountry` | how to parse a phone number everywhere else |
 *
 * That is the functional duplication AGENTS.md §10 forbids, and it was not
 * merely untidy. A tenant could set four different answers to one question and
 * get four inconsistent behaviours: their phone numbers parsed as Turkish while
 * their holidays came from Germany. Worse, nothing on any settings screen said
 * these were the same fact, so there was no way for an operator to notice.
 *
 * One key, in the `Localization` group beside `defaultLanguage` and
 * `defaultTimezone`, for the same reason those are there: it is a property of
 * where the tenant is, not of any one feature. Migration 031 folds the old keys
 * in and drops them.
 *
 * ## What this is NOT
 *
 * It is not the *legal* country of a company. `organization_legal_entities`
 * carries its own `countryCode` per entity, and `invoice`'s `companyCountryCode`
 * is the registered seller address an e-invoice must quote. A Turkish group's
 * German subsidiary genuinely has a different answer, and the call sites that
 * care pass that row's own country instead of this one.
 *
 * ## Failing open
 *
 * Catch-to-default, like `resolveTenantLanguages`: a settings read must never be
 * able to fail the operation it decorates. A contact save that 500s because
 * Redis blinked while fetching a PARSING HINT is a worse outcome than one that
 * falls back — and any phone number already written in `+…` form ignores the
 * hint entirely, so the blast radius is national-format input only.
 */

/**
 * Used when the tenant has not configured one, or configured something that is
 * not a dialable territory. Turkey — the platform's primary market, and what all
 * five predecessors defaulted to.
 *
 * Mirrored as a literal in `./tenant_setting.localization.fields`, which cannot
 * import this module (it reaches `SettingService` and therefore the whole
 * TypeORM stack, and a `'use client'` settings page imports it).
 * `tests/tenant_setting.country.test.ts` keeps the pair honest.
 */
export const DEFAULT_COUNTRY = 'TR';

/** Setting key, in the `Localization` group. */
export const COUNTRY_SETTING_KEY = 'defaultCountry';

/**
 * Validated against the dialing catalogue rather than a bare length check.
 *
 * A two-letter string is not a territory, and one with no dialing plan cannot
 * help parse a national number — `XX` handed to libphonenumber rejects every
 * national number silently, which reads to the operator as "the system says my
 * own phone number is invalid".
 */
export function normalizeCountry(value: string | null | undefined): string {
  const code = (value || '').trim().toUpperCase();
  if (code.length !== 2 || !getDialing(code)) return DEFAULT_COUNTRY;
  return code;
}

/** The tenant's ISO-3166 alpha-2 country. Never throws. */
export async function resolveTenantCountry(tenantId: string): Promise<string> {
  let record: Record<string, string> = {};
  try {
    record = await SettingService.getByKeys(tenantId, [COUNTRY_SETTING_KEY]);
  } catch {
    record = {};
  }
  return normalizeCountry(record[COUNTRY_SETTING_KEY]);
}

/**
 * The tenant's country and whether the tenant set it (41-ui-fixes/16 C6). `defaulted` is true when there is no usable
 * setting (unset, not a dialable territory, or unreadable) and `country` is {@link DEFAULT_COUNTRY}: for a caller that
 * must tell the operator its answer is the platform's guess, as the till's tax does. Never throws.
 */
export async function resolveTenantCountryInfo(tenantId: string): Promise<{ country: string; defaulted: boolean }> {
  let raw: string | undefined;
  try {
    raw = (await SettingService.getByKeys(tenantId, [COUNTRY_SETTING_KEY]))?.[COUNTRY_SETTING_KEY];
  } catch {
    raw = undefined;
  }
  const given = (raw || '').trim().toUpperCase();
  const country = normalizeCountry(given);
  return { country, defaulted: country !== given };
}

/**
 * contact.57: the tenant's country for a caller that STORES what the region decides (a phone number normalised to E.164, an
 * SMS opt-out key). Unlike `resolveTenantCountry` it does not guess: when the settings store cannot be read it throws (503),
 * so the caller refuses a national-format number (or accepts only `+…` input) instead of filing it under the default
 * region's number. A tenant that never configured a country still gets `DEFAULT_COUNTRY`: that is an answer, not a guess.
 */
export async function resolveTenantCountryStrict(tenantId: string): Promise<string> {
  let record: Record<string, string>;
  try {
    record = await SettingService.getByKeys(tenantId, [COUNTRY_SETTING_KEY]);
  } catch {
    // The cause (a driver or Redis error) is not the caller's to see (E-17); the answer is a generic, retryable 503.
    throw new AppError('The tenant country is temporarily unavailable.', 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
  }
  return normalizeCountry(record?.[COUNTRY_SETTING_KEY]);
}
