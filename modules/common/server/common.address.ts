import { z } from 'zod'
import { CountryCodeEnum } from './common.country'

/**
 * THE postal address shape (audit 2026-08, PLAT-06).
 *
 * Six incompatible representations existed for the same thing:
 * `organization_legal_entities.addressJson` (an open `Record<string, unknown>`
 * documented as `{line1, line2, city, region, postalCode, countryCode}`),
 * `contact_companies`' flat columns, `hr_employee_personal`'s flat columns with
 * different names, `payment`'s jsonb, `invoice.customerAddress` typed literally
 * `object`, and `commerce_order` — which has no address at all, so a shipping
 * address only existed inside a fulfillment label call.
 *
 * That is affordable right up until something has to READ one it did not write.
 * Turkish e-Arşiv and Peppol both need structured fields — `il`, `ilçe`, postal
 * code, country — and neither can be recovered from a free-form blob. A tax
 * engine cannot decide a rate from `Record<string, unknown>`.
 *
 * ## What this is, and what it deliberately is not
 *
 * A VALUE OBJECT: a zod schema plus two helpers, living in `common` beside
 * `Money` and `pagination`. There is no `addresses` table and no `address`
 * module, because AGENTS.md §10's over-abstraction test is not met — an address
 * is not independently sellable, it has no lifecycle of its own, and every
 * consumer already stores it inline. Extracting a table would buy a join and a
 * new module boundary in exchange for nothing.
 *
 * What the shared schema buys is the thing that was actually missing: one set
 * of field names, so a `contact` address can be handed to `invoice`, and one
 * validation, so `countryCode` is a real sovereign ISO code rather than whatever
 * the form posted.
 *
 * ## Field choices
 *
 * `line1`/`line2` rather than `addressLine1`/`street`: the shortest names that
 * are still unambiguous, and the ones `organization` already documents.
 *
 * `region` rather than `state` or `province`: Türkiye has `il`, the UK has
 * counties, Japan has prefectures. `state` is a US-shaped name for a field the
 * whole world fills in.
 *
 * `countryCode` is validated against the SOVEREIGN alpha-2 set (DUP-05) — the
 * fiscal variant, not the display one. A postal address on an invoice has to
 * name a jurisdiction; region pseudo-codes belong to pickers, not to documents.
 *
 * Everything except `countryCode` is optional. A partial address is normal
 * (a customer who gave a city and nothing else) and refusing to store it would
 * push callers straight back to a blob.
 */
export const AddressSchema = z.object({
  /** Street address, building, number. */
  line1: z.string().trim().min(1).max(255).optional(),
  /** Apartment, floor, district — anything the first line did not hold. */
  line2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  /** Province / state / il / prefecture — the first-level subdivision. */
  region: z.string().trim().max(120).optional(),
  postalCode: z.string().trim().max(32).optional(),
  /** ISO-3166-1 alpha-2, sovereign set. The one field that is required. */
  countryCode: CountryCodeEnum,
})
export type Address = z.infer<typeof AddressSchema>

/** For the many places that hold an address only sometimes. */
export const OptionalAddressSchema = AddressSchema.nullable()

/**
 * Parse an address that arrived in one of the older shapes.
 *
 * The six representations all exist in live rows, so a migration that demanded
 * they be rewritten first would have to be a data migration across six modules.
 * This reads them instead: the common aliases are mapped, the country code is
 * upper-cased, and blank strings are dropped rather than stored as `''` — an
 * empty city is not a city.
 *
 * Returns `null` when there is no usable country code, because an address that
 * cannot name a jurisdiction cannot be put on a document; the caller keeps the
 * original blob and decides what to do about it. Throwing here would turn every
 * historic partial row into a 500 on read.
 */
export function parseAddress(value: unknown): Address | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const str = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const v = raw[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return undefined
  }

  const countryCode = str('countryCode', 'country', 'country_code')?.toUpperCase()
  const candidate = {
    line1: str('line1', 'addressLine1', 'address1', 'street'),
    line2: str('line2', 'addressLine2', 'address2'),
    city: str('city', 'town'),
    region: str('region', 'state', 'province', 'il'),
    postalCode: str('postalCode', 'postal_code', 'zip', 'zipCode'),
    countryCode,
  }
  const parsed = AddressSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * A one-line rendering for a list, an email or a label.
 *
 * Not a substitute for a locale-aware formatter — address ORDER differs by
 * country (Japan writes largest-first) and getting that right is a job for the
 * postal format tables, not for a helper in `common`. This is the "show it in a
 * table cell" form, and it is named so nobody mistakes it for the other thing.
 */
export function formatAddressLine(address: Address): string {
  return [address.line1, address.line2, address.postalCode, address.city, address.region, address.countryCode]
    .filter(Boolean)
    .join(', ')
}
