// Legal-entity deduplication — WRITE-THROUGH PROJECTION, not read-through.
//
// Before this module existed, the tenant's own legal identity was stored three
// times, in three unrelated settings families:
//
//   invoice        13 `company*` keys, read by InvoicePdfService.loadSeller()
//   terms_consent   7 `legalSeller*` keys, interpolated into distance-selling docs
//   payment         taxId / vatNumber / billingName / billingAddress
//
// `organization` becomes the EDITOR. Every time the default LegalEntity is
// written, its fields are projected onto those 24 keys, and the keys are then
// locked so the old panels render read-only.
//
// Why projection and not "the consumers read organization":
//   * ZERO code change in invoice / terms_consent / payment. loadSeller() is not
//     touched, so there is no way for this refactor to break an invoice PDF.
//   * ZERO new `requires` edges. Read-through would force `organization` on
//     every tenant that issues an invoice — and business modules default to OFF
//     per tenant. `tenant_setting` is AMBIENT, so this file adds no edge at all.
//   * When `organization` is disabled again, settings keep their last projected
//     value and everything downstream keeps working.
//
// The inverse direction runs exactly once: `importFromSettings` materialises the
// first LegalEntity from whatever those keys already held, so enabling the
// module loses nothing.

import type { LegalEntity } from './entities/organization_legal_entities.entity'

type Address = Record<string, unknown> | null | undefined

const str = (v: unknown): string => (v == null ? '' : String(v))

const addr = (a: Address, key: string): string => str(a?.[key])

/** One line of postal address, for the consumers that store it as a single string. */
export function flattenAddress(a: Address): string {
  return [addr(a, 'line1'), addr(a, 'line2'), addr(a, 'postalCode'), addr(a, 'city'), addr(a, 'region')]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ')
}

/** invoice's issuer block — the 13 `company*` keys `loadSeller()` reads. */
export const INVOICE_COMPANY_KEYS = [
  'companyLegalName', 'companyTaxId', 'companyTaxOffice',
  'companyAddressLine1', 'companyAddressLine2', 'companyCity',
  'companyPostalCode', 'companyCountryCode', 'companyPhone',
  'companyEmail', 'companyWebsite', 'companyLogoUrl', 'companyIban',
] as const

/** terms_consent's seller legal identity (SELLER_LEGAL_KEYS over there). */
export const TERMS_CONSENT_SELLER_KEYS = [
  'legalSellerName', 'legalSellerAddress', 'legalSellerTaxOffice',
  'legalSellerTaxId', 'legalSellerMersis', 'legalSellerEmail', 'legalSellerPhone',
] as const

/** payment's tenant-billing identity keys. */
export const PAYMENT_BILLING_KEYS = [
  'taxId', 'vatNumber', 'billingName', 'billingAddress',
] as const

/** Every key this module writes through. Locked after each projection. */
export const PROJECTED_SETTING_KEYS: readonly string[] = [
  ...INVOICE_COMPANY_KEYS,
  ...TERMS_CONSENT_SELLER_KEYS,
  ...PAYMENT_BILLING_KEYS,
]

/** Source of truth for one projected key, so both directions stay in one table. */
type Projectable = Pick<
  LegalEntity,
  | 'legalName' | 'tradeName' | 'countryCode' | 'taxId' | 'taxOffice' | 'vatNumber'
  | 'registrationNumber' | 'addressJson' | 'email' | 'phone' | 'website' | 'iban'
  | 'logoStorageKey'
>

/**
 * `companyLogoUrl` is a URL in invoice's PDF renderer; `logoStorageKey` may be
 * an opaque storage key. Projecting a key where a URL is expected would print a
 * broken image, so only an absolute URL is projected — anything else leaves the
 * existing setting untouched.
 */
function logoUrlOf(entity: Projectable): string | null {
  const v = str(entity.logoStorageKey).trim()
  // organization.03: every invoice renderer may FETCH this URL, so only https on a
  // host the platform serves files from (the app host or the configured public
  // storage host) is projected; anything else leaves the setting untouched.
  let u: URL
  try { u = new URL(v) } catch { return null }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const allowed = [process.env.STORAGE_PUBLIC_BASE_URL, process.env.APPLICATION_HOST, process.env.NEXT_PUBLIC_APP_URL]
    .flatMap((x) => { try { return x ? [new URL(x).host] : [] } catch { return [] } })
  return allowed.includes(u.host) ? v : null
}

/**
 * The whole projection as a flat `key -> value` map.
 *
 * Absent fields project as `''` on purpose: the legal entity is now the editor,
 * so clearing a field there must clear it downstream. The single exception is
 * `companyLogoUrl` (see `logoUrlOf`), which is omitted rather than blanked.
 */
export function buildProjection(entity: Projectable): Record<string, string> {
  const a = entity.addressJson
  const address = flattenAddress(a)
  const values: Record<string, string> = {
    // ── invoice ─────────────────────────────────────────────────────────────
    companyLegalName: str(entity.legalName),
    companyTaxId: str(entity.taxId),
    companyTaxOffice: str(entity.taxOffice),
    companyAddressLine1: addr(a, 'line1'),
    companyAddressLine2: addr(a, 'line2'),
    companyCity: addr(a, 'city'),
    companyPostalCode: addr(a, 'postalCode'),
    companyCountryCode: str(entity.countryCode),
    companyPhone: str(entity.phone),
    companyEmail: str(entity.email),
    companyWebsite: str(entity.website),
    companyIban: str(entity.iban),

    // ── terms_consent ───────────────────────────────────────────────────────
    legalSellerName: str(entity.legalName),
    legalSellerAddress: address,
    legalSellerTaxOffice: str(entity.taxOffice),
    legalSellerTaxId: str(entity.taxId),
    legalSellerMersis: str(entity.registrationNumber),
    legalSellerEmail: str(entity.email),
    legalSellerPhone: str(entity.phone),

    // ── payment ─────────────────────────────────────────────────────────────
    taxId: str(entity.taxId),
    vatNumber: str(entity.vatNumber),
    billingName: str(entity.tradeName) || str(entity.legalName),
    billingAddress: address,
  }
  const logo = logoUrlOf(entity)
  if (logo) values.companyLogoUrl = logo
  return values
}

/** What `importFromSettings` reconstructs from the legacy keys. */
export interface ImportedLegalEntity {
  legalName: string
  tradeName?: string
  countryCode: string
  taxId?: string
  taxOffice?: string
  vatNumber?: string
  registrationNumber?: string
  addressJson?: Record<string, unknown>
  email?: string
  phone?: string
  website?: string
  iban?: string
  logoStorageKey?: string
}

const pick = (v: string | undefined): string | undefined => {
  const t = (v ?? '').trim()
  return t.length > 0 ? t : undefined
}

/**
 * Reverse map: the first LegalEntity a tenant gets when `organization` is
 * enabled, built from whatever the three legacy families already held.
 *
 * Returns `null` when there is nothing worth importing — a tenant with no
 * company name and no tax id has nothing to preserve, and inventing an entity
 * called "" would be worse than having none.
 *
 * Precedence is invoice → terms_consent → payment, because invoice's keys are
 * the ones a tenant has to fill in to print a legally valid document, so they
 * are the likeliest to be complete.
 */
export function legalEntityFromSettings(values: Record<string, string>): ImportedLegalEntity | null {
  const legalName = pick(values.companyLegalName) ?? pick(values.legalSellerName) ?? pick(values.billingName)
  const taxId = pick(values.companyTaxId) ?? pick(values.legalSellerTaxId) ?? pick(values.taxId)
  if (!legalName && !taxId) return null

  const line1 = pick(values.companyAddressLine1)
  const line2 = pick(values.companyAddressLine2)
  const city = pick(values.companyCity)
  const postalCode = pick(values.companyPostalCode)
  const countryCode = (pick(values.companyCountryCode) ?? 'TR').slice(0, 2).toUpperCase()

  const addressJson: Record<string, unknown> = {}
  if (line1) addressJson.line1 = line1
  if (line2) addressJson.line2 = line2
  if (city) addressJson.city = city
  if (postalCode) addressJson.postalCode = postalCode
  if (countryCode) addressJson.countryCode = countryCode
  // Nothing structured survived, but terms_consent may still hold a flat string.
  const flat = pick(values.legalSellerAddress) ?? pick(values.billingAddress)
  if (Object.keys(addressJson).length <= 1 && flat) addressJson.line1 = flat

  return {
    legalName: legalName ?? (taxId as string),
    tradeName: pick(values.billingName) !== legalName ? pick(values.billingName) : undefined,
    countryCode,
    taxId,
    taxOffice: pick(values.companyTaxOffice) ?? pick(values.legalSellerTaxOffice),
    vatNumber: pick(values.vatNumber) ?? pick(values.euVatNumber),
    registrationNumber: pick(values.legalSellerMersis),
    addressJson: Object.keys(addressJson).length > 0 ? addressJson : undefined,
    email: pick(values.companyEmail) ?? pick(values.legalSellerEmail) ?? pick(values.billingEmail),
    phone: pick(values.companyPhone) ?? pick(values.legalSellerPhone),
    website: pick(values.companyWebsite),
    iban: pick(values.companyIban),
    logoStorageKey: pick(values.companyLogoUrl),
  }
}

/** Keys read back when importing. A superset of what is projected. */
export const IMPORTABLE_SETTING_KEYS: readonly string[] = [
  ...PROJECTED_SETTING_KEYS,
  'euVatNumber',
  'billingEmail',
]
