import { z } from 'zod'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { OrganizationRefKindEnum } from './organization.enums'
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query'

/** Postal address parts — open shape, because it is country-specific. */

/**
 * organization.08: a query-string boolean. `z.coerce.boolean()` read the STRING
 * 'false' as true; 'true' / '1' are true, 'false' / '0' false, anything else a 400.
 */
/** organization.07: an IBAN passes the ISO 13616 mod-97 check (spaces ignored). */
export function isValidIban(raw: string): boolean {
  const v = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(v)) return false
  const moved = v.slice(4) + v.slice(0, 4)
  let rem = 0
  for (const ch of moved) {
    const d = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch
    for (const c of d) rem = (rem * 10 + Number(c)) % 97
  }
  return rem === 1
}
const isTimeZone = (tz: string): boolean => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false } }

const QueryBool = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === true ? true : v === 'false' || v === '0' || v === false ? false : v),
  z.boolean().optional(),
)

export const AddressJsonDTO = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  countryCode: z.string().length(2).optional(),
}).passthrough()
export type AddressJsonDTO = z.infer<typeof AddressJsonDTO>

// ============================================================================
// LegalEntity
// ============================================================================

export const CreateLegalEntityDTO = z.object({
  /** Omit to let the service allocate `<organizationLegalEntityCodePrefix><seq>`. */
  code: z.string().min(1).optional(),
  legalName: z.string().min(1),
  tradeName: z.string().optional(),
  legalForm: z.string().optional(),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/, 'countryCode must be an ISO 3166-1 alpha-2 code'),
  taxId: z.string().optional(),
  taxOffice: z.string().optional(),
  vatNumber: z.string().optional(),
  registrationNumber: z.string().optional(),
  addressJson: AddressJsonDTO.optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  iban: z.string().refine(isValidIban, 'Not a valid IBAN').optional(),
  bankName: z.string().optional(),
  logoStorageKey: z.string().max(512).optional(),
  /** Promoting a new default demotes the previous one in the same transaction. */
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
})
export type CreateLegalEntityDTO = z.infer<typeof CreateLegalEntityDTO>

export const UpdateLegalEntityDTO = patchSchema(CreateLegalEntityDTO)
export type UpdateLegalEntityDTO = z.infer<typeof UpdateLegalEntityDTO>

/** Public sort fields → entity properties (phase 43 list contract). */
export const LEGAL_ENTITY_SORTABLE = {
  code: 'code', legalName: 'legalName', countryCode: 'countryCode', isDefault: 'isDefault', isActive: 'isActive',
  createdAt: 'createdAt',
} as const

export const GetLegalEntitiesQuery = listQuerySchema({
  sortable: LEGAL_ENTITY_SORTABLE,
  // The default entity is the row an operator looks for by default.
  defaultSort: 'isDefault:desc,code:asc',
  filters: { isActive: QueryBool },
})
export type GetLegalEntitiesQuery = z.infer<typeof GetLegalEntitiesQuery>
/** The default order, for callers that pass a query without `sort`. */
export const LEGAL_ENTITY_DEFAULT_SORT = GetLegalEntitiesQuery.parse({}).sort

// ============================================================================
// Site
// ============================================================================

export const CreateSiteDTO = z.object({
  /** Omit to let the service allocate `<organizationSiteCodePrefix><seq>`. */
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  /** Free-form tag; SITE_KINDS is the suggested vocabulary, not a constraint. */
  kind: z.string().min(1).optional().default('OFFICE'),
  legalEntityId: z.string().uuid().nullish(),
  addressJson: AddressJsonDTO.optional(),
  countryCode: z.string().length(2).optional(),
  city: z.string().optional(),
  timezone: z.string().refine(isTimeZone, 'Unknown time zone').optional(),
  isHeadquarters: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
})
export type CreateSiteDTO = z.infer<typeof CreateSiteDTO>

export const UpdateSiteDTO = patchSchema(CreateSiteDTO)
export type UpdateSiteDTO = z.infer<typeof UpdateSiteDTO>

export const SITE_SORTABLE = {
  code: 'code', name: 'name', kind: 'kind', city: 'city', countryCode: 'countryCode',
  isHeadquarters: 'isHeadquarters', isActive: 'isActive', createdAt: 'createdAt',
} as const

export const GetSitesQuery = listQuerySchema({
  sortable: SITE_SORTABLE,
  // Headquarters first: it is the row an operator looks for by default.
  defaultSort: 'isHeadquarters:desc,code:asc',
  filters: {
    kind: listFilter.ids(),
    legalEntityId: listFilter.uuids(),
    isActive: QueryBool,
  },
})
export type GetSitesQuery = z.infer<typeof GetSitesQuery>
export const SITE_DEFAULT_SORT = GetSitesQuery.parse({}).sort

// ============================================================================
// CostCenter
// ============================================================================

/**
 * A cost-center code is a segment of the materialised path (`/GY/SAT`), so it is
 * restricted to a safe alphabet: no `/` (it would forge a level), no `%`, spaces
 * or other punctuation (organization.04).
 */
const CostCenterCode = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Code may contain only letters, digits, "_", "." and "-"')

export const CreateCostCenterDTO = z.object({
  /** Omit to let the service allocate `<organizationCostCenterCodePrefix><seq>`. */
  code: CostCenterCode.optional(),
  name: z.string().min(1),
  parentId: z.string().uuid().optional(),
  glAccountId: z.string().uuid().optional(),
  isActive: z.boolean().optional().default(true),
})
export type CreateCostCenterDTO = z.infer<typeof CreateCostCenterDTO>

/** `parentId: null` detaches the node and makes it a root. */
export const UpdateCostCenterDTO = patchSchema(CreateCostCenterDTO).extend({
  parentId: z.string().uuid().nullable().optional(),
})
export type UpdateCostCenterDTO = z.infer<typeof UpdateCostCenterDTO>

export const COST_CENTER_SORTABLE = {
  path: 'path', code: 'code', name: 'name', isActive: 'isActive', createdAt: 'createdAt',
} as const

export const GetCostCentersQuery = listQuerySchema({
  sortable: COST_CENTER_SORTABLE,
  // By path: a depth-first tree the UI can indent directly.
  defaultSort: 'path:asc',
  filters: { isActive: QueryBool },
})
export type GetCostCentersQuery = z.infer<typeof GetCostCentersQuery>
export const COST_CENTER_DEFAULT_SORT = GetCostCentersQuery.parse({}).sort

// ============================================================================
// Lookup
// ============================================================================

export const GetOrganizationOptionsQuery = z.object({
  kind: OrganizationRefKindEnum,
})
export type GetOrganizationOptionsQuery = z.infer<typeof GetOrganizationOptionsQuery>

/**
 * Batch label request. Bounded on both axes: at most one entry per kind and 500
 * ids each, so a list page can resolve a whole viewport in one call without
 * turning into an unbounded IN(...).
 */
export const ResolveOrganizationLabelsDTO = z.object({
  refs: z
    .array(
      z.object({
        kind: OrganizationRefKindEnum,
        ids: z.array(z.string().uuid()).max(500),
      }),
    )
    .max(3)
    // organization.11: each kind once, and at most 500 ids in total (one bounded lookup).
    .refine((refs) => new Set(refs.map((r) => r.kind)).size === refs.length, 'Each kind may appear once')
    .refine((refs) => refs.reduce((n, r) => n + r.ids.length, 0) <= 500, 'At most 500 ids in one lookup'),
})
export type ResolveOrganizationLabelsDTO = z.infer<typeof ResolveOrganizationLabelsDTO>
