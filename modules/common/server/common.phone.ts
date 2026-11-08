import { z } from 'zod'
// `libphonenumber-js/max` — the MAX metadata set, deliberately.
//
// The default (`min`) metadata omits, for most countries, the digit regexes
// `.isValid()` needs; it can only answer `.isPossible()`, which is a length
// check. `+9012` is the right length for something and would pass. The one
// invariant this file exists to hold — that a stored number is a number an
// inbound call can actually match — is exactly what `min` cannot check.
// `telephony.phone.test.ts` pins two cases (`+9012`, `+905321`) that fail the
// moment someone "optimises" this import to the smaller set.
//
// Client code must NOT import this module: max metadata is ~158 KB. The phone
// INPUT uses `libphonenumber-js/min` for as-you-type feedback only, and the
// server stays the authority. See `localization/ui/phone-input.component.tsx`.
import { parsePhoneNumberFromString } from 'libphonenumber-js/max'

import { AppError, ErrorCode } from './app-error'

/**
 * THE phone-number value object.
 *
 * Same shape of problem `common.address.ts` solved for postal addresses, and
 * solved the same way. Phone numbers were already being parsed in one place —
 * `notification_sms.provider.service.ts` — to pick an SMS provider by region.
 * `telephony` needs the identical operation for the opposite direction: an
 * inbound call arrives as `+905321234567` and something has to decide which
 * contact that is.
 *
 * `telephony` cannot import `notification_sms` (sibling domain, not fabric), so
 * the choice was to copy fifteen lines or to lift them here. AGENTS.md §10
 * clause 4 forbids the copy.
 *
 * ## What this is, and what it deliberately is not
 *
 * A VALUE OBJECT: a schema plus a few helpers, beside `Money`, `Address` and
 * pagination. No table, no module — a phone number is not independently
 * sellable and has no lifecycle of its own.
 *
 * What the shared helper buys is the thing reverse lookup actually needs:
 * ONE canonical key. `0532 123 45 67`, `+90 532 123 45 67`, `905321234567` and
 * `(0532) 123-4567` are the same subscriber, and an index is only as good as the
 * guarantee that all four normalize identically. `telephony.phone.test.ts` pins
 * exactly that.
 *
 * ## Why a default region is required for national input
 *
 * `0532…` is meaningless without knowing the country — libphonenumber cannot
 * parse it region-free. Callers pass the TENANT's region, which
 * `resolveTenantCountry` in `tenant_setting` answers; a number already in
 * `+…` form ignores the hint entirely. It is a per-tenant fact, never a
 * platform-wide one: one deployment can host a Turkish and a German tenant at
 * the same time.
 *
 * ## Strict or lenient is the CALLER's decision
 *
 * Two write helpers, because the two kinds of caller genuinely differ:
 * `requireE164` for a form a person filled in, `normalizeE164Lenient` for a
 * payload a third party sent us. Rejecting an identity provider's SCIM sync
 * because one of 4000 users has a malformed number fails the whole sync; the
 * same input typed into an admin form should be corrected at the keyboard.
 */

/** ISO-3166-1 alpha-2 used only as a parsing hint — not a jurisdiction claim. */
export type PhoneRegion = string

/** E.164: a leading `+`, then 1–15 digits, first digit non-zero. */
export const E164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, 'Must be an E.164 phone number, e.g. +905321234567')
export type E164 = z.infer<typeof E164Schema>

export interface ParsedPhone {
  /** Canonical E.164 form — the value to store and to index on. */
  e164: E164
  /** ISO-3166-1 alpha-2 the number resolves to, when libphonenumber can tell. */
  regionCode: string | null
  /** National (in-country) rendering, for display only. */
  national: string
}

/**
 * Parse anything a human or a carrier might hand us into a canonical form.
 *
 * Returns `null` rather than throwing, for the same reason `parseAddress` does:
 * historic rows hold free text ("0212 555 00 00 dahili 12", "bilinmiyor") and a
 * throwing parser turns every read of one into a 500. The caller decides whether
 * an unparseable number is a validation error (a form) or simply not indexable
 * (a backfill).
 *
 * Validity is checked, not just parseability: `+9012` parses and is not a real
 * number. Storing it would put a row into the index that no inbound call can
 * ever match.
 */
export function parsePhone(input: string | null | undefined, defaultRegion?: PhoneRegion): ParsedPhone | null {
  if (!input) return null
  const raw = input.trim()
  if (!raw) return null

  try {
    // The region hint is dropped for a number already in international form, so
    // a US number typed into a Turkish tenant is not re-homed to TR.
    const region = raw.startsWith('+') ? undefined : defaultRegion?.toUpperCase()
    const parsed = parsePhoneNumberFromString(raw, region as never)
    if (!parsed || !parsed.isValid()) return null
    return {
      e164: parsed.number,
      regionCode: parsed.country ?? null,
      national: parsed.formatNational(),
    }
  } catch {
    return null
  }
}

/** The canonical key alone — the common case for indexing and lookups. */
export function toE164(input: string | null | undefined, defaultRegion?: PhoneRegion): E164 | null {
  return parsePhone(input, defaultRegion)?.e164 ?? null
}

/**
 * Display rendering for a stored E.164 value.
 *
 * Falls back to the input when it cannot be parsed, because a list cell showing
 * the raw stored string is strictly better than one showing nothing.
 */
export function formatPhone(e164: string, defaultRegion?: PhoneRegion): string {
  return parsePhone(e164, defaultRegion)?.national ?? e164
}

/**
 * Canonicalize a number a PERSON typed, refusing anything that is not one.
 *
 * For interactive write paths — admin forms, the softphone, self-service
 * profile edits. The person is at the keyboard and can fix it; storing their
 * typo silently is the worse outcome, because the number will simply never
 * connect and nothing will say why.
 *
 * `undefined`/empty in returns `null` out rather than throwing: "no phone
 * number" is a legitimate answer for every one of these columns. Requiredness
 * is the DTO's business, not this function's.
 */
export function requireE164(
  input: string | null | undefined,
  defaultRegion: PhoneRegion | undefined,
  fieldLabel = 'Phone number',
): E164 | null {
  if (input === null || input === undefined) return null
  const raw = input.trim()
  if (!raw) return null

  const parsed = parsePhone(raw, defaultRegion)
  if (!parsed) {
    throw new AppError(
      `${fieldLabel}: '${raw}' is not a valid phone number`,
      400,
      ErrorCode.VALIDATION_ERROR,
    )
  }
  return parsed.e164
}

/**
 * Canonicalize when possible, keep what we were given when not.
 *
 * For MACHINE write paths — SCIM provisioning, payment-gateway callbacks,
 * carrier webhooks, bulk import. We do not control the sender and cannot ask it
 * to try again, so a number we cannot parse must not be able to fail the
 * operation that carried it. The column ends up holding E.164 for everything
 * parseable and the original string for the rest, which is strictly better than
 * either dropping the value or 500ing the sync.
 *
 * Trimmed even on the fallback path, so trailing whitespace never becomes the
 * difference between two otherwise-equal rows.
 */
export function normalizeE164Lenient(
  input: string | null | undefined,
  defaultRegion?: PhoneRegion,
): string | null {
  if (input === null || input === undefined) return null
  const raw = input.trim()
  if (!raw) return null
  return parsePhone(raw, defaultRegion)?.e164 ?? raw
}

/** `emergencyContactPhoneAlt` → `Emergency contact phone alt`, for error text. */
function humanizeField(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Canonicalize the named phone columns of a DTO in one pass.
 *
 * Every service that stores a phone number does the same three things — pick
 * the phone-ish keys out of the DTO, run them through the parser, put them
 * back — and most of them do it while spreading the DTO straight into
 * `repo.create({ tenantId, ...data })`. `hr` alone has eight such fields across
 * four DTOs. Written out longhand that is the copy AGENTS.md §10 forbids, and
 * the copies WOULD drift: the first one to forget a field is a column quietly
 * back to storing national format, which nothing detects until a reverse lookup
 * misses.
 *
 * Only keys actually PRESENT on the object are touched, so this is safe on a
 * partial-update DTO: a field the caller did not send stays absent rather than
 * becoming `null` and erasing a stored number.
 *
 * Returns a new object; the input is not mutated.
 */
export function normalizePhoneFields<T extends object>(
  data: T,
  fields: ReadonlyArray<keyof T & string>,
  defaultRegion: PhoneRegion | undefined,
  mode: 'strict' | 'lenient' = 'strict',
): T {
  const out = { ...data }
  for (const field of fields) {
    if (!(field in out)) continue
    const value = out[field] as unknown
    if (value === undefined) continue
    if (value !== null && typeof value !== 'string') continue

    const normalized = mode === 'strict'
      ? requireE164(value, defaultRegion, humanizeField(field))
      : normalizeE164Lenient(value, defaultRegion)
    out[field] = normalized as T[keyof T & string]
  }
  return out
}
