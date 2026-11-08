import { z } from 'zod'
import { OrganizationRefKindEnum } from './organization.enums'

// Row shapes as they cross the wire. Each table also publishes a `Safe*Schema`
// that omits `deletedAt` — the shape a client is allowed to see, so a soft-delete
// timestamp never leaks into an admin table or a picker payload.

// ============================================================================
// LegalEntity
// ============================================================================

export const LegalEntitySchema = z.object({
  legalEntityId: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string(),
  legalName: z.string(),
  tradeName: z.string().nullable(),
  legalForm: z.string().nullable(),
  countryCode: z.string(),
  taxId: z.string().nullable(),
  taxOffice: z.string().nullable(),
  vatNumber: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  addressJson: z.record(z.string(), z.unknown()).nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  iban: z.string().nullable(),
  bankName: z.string().nullable(),
  logoStorageKey: z.string().nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
})
export type LegalEntity = z.infer<typeof LegalEntitySchema>

export const SafeLegalEntitySchema = LegalEntitySchema.omit({ deletedAt: true })
export type SafeLegalEntity = z.infer<typeof SafeLegalEntitySchema>

// ============================================================================
// Site
// ============================================================================

export const SiteSchema = z.object({
  siteId: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  legalEntityId: z.string().uuid().nullable(),
  addressJson: z.record(z.string(), z.unknown()).nullable(),
  countryCode: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  isHeadquarters: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
})
export type Site = z.infer<typeof SiteSchema>

export const SafeSiteSchema = SiteSchema.omit({ deletedAt: true })
export type SafeSite = z.infer<typeof SafeSiteSchema>

// ============================================================================
// CostCenter
// ============================================================================

export const CostCenterSchema = z.object({
  costCenterId: z.string().uuid(),
  tenantId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  path: z.string(),
  glAccountId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
  deletedAt: z.date().nullable(),
})
export type CostCenter = z.infer<typeof CostCenterSchema>

export const SafeCostCenterSchema = CostCenterSchema.omit({ deletedAt: true })
export type SafeCostCenter = z.infer<typeof SafeCostCenterSchema>

// ============================================================================
// Lookup
// ============================================================================

/** One picker entry — everything a `<Select>` needs and nothing else. */
export const OrganizationOptionSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
})
export type OrganizationOption = z.infer<typeof OrganizationOptionSchema>

/** Batch label map keyed `"<kind>:<id>"`. */
export const OrganizationLabelMapSchema = z.record(z.string(), z.string())
export type OrganizationLabelMap = z.infer<typeof OrganizationLabelMapSchema>

/** What one `organization:reference_check` contribution reports back. */
export const OrganizationReferenceHitSchema = z.object({
  moduleId: z.string(),
  count: z.number().int().nonnegative(),
  label: z.string(),
})
export type OrganizationReferenceHit = z.infer<typeof OrganizationReferenceHitSchema>

/** The `{ kind, id }` pair a reference check is asked about. */
export const OrganizationRefSchema = z.object({
  kind: OrganizationRefKindEnum,
  id: z.string().uuid(),
})
export type OrganizationRef = z.infer<typeof OrganizationRefSchema>
