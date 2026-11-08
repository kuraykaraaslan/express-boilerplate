import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { z } from 'zod';
import { TenantStatusEnum, WritableTenantStatusEnum } from './tenant.enums';
import { ALLOWED_REGIONS } from './entities/tenant.entity';
import { isReservedSubdomainLabel, TENANT_LABEL_MAX, TENANT_LABEL_MIN, TENANT_LABEL_PATTERN } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { COUNTRY_CODES, COUNTRY_SOURCES, normalizeCountryCode } from './tenant.country';

const TenantRegionEnum = z.enum([...ALLOWED_REGIONS] as [string, ...string[]]);
// Create/provision want the platform default when the caller omits a region.
// Update must NOT default — see UpdateTenantDTO.
export const TenantRegionSchema = TenantRegionEnum.default('TR');

/**
 * An ISO 3166-1 alpha-2 country (phase 49.1), trimmed and upper-cased; anything that is not an assigned code is refused. Only the platform
 * operator writes it (the operator PUT / POST bodies); the tenant owner's own profile update has no country, on purpose: picking a cheaper
 * country would be a pricing hole.
 */
export const CountryCodeSchema = z.string().trim().transform((v) => normalizeCountryCode(v)).refine((v): v is string => v !== null, 'Unknown country code');

// URL-safe slug, one DNS label: lowercase letters, digits, hyphens (no leading/trailing hyphen, never a dot), 5 to 63
// characters (owner 2026-11-04; `tenantLabelProblem` in tenant-constants is the same rule for the other paths)
export const SlugSchema = z
  .string()
  .min(TENANT_LABEL_MIN, `Slug must be at least ${TENANT_LABEL_MIN} characters`)
  .max(TENANT_LABEL_MAX)
  .regex(TENANT_LABEL_PATTERN, 'Slug must be lowercase alphanumeric with hyphens')
  // The slug names the tenant's free `<slug>.<wildcard>` subdomain, so the platform's own labels (admin, www, api, auth,
  // app ...) are not available. The reserved platform tenants are seeded, never parsed through this schema.
  .refine((slug) => !isReservedSubdomainLabel(slug), 'Slug is reserved')
  .optional();

export const CreateTenantDefaultsDTO = z.object({
  skipPlan: z.boolean().optional(),
  skipSubscription: z.boolean().optional(),
  skipSettings: z.boolean().optional(),
}).optional();

export const CreateTenantDTO = z.object({
  name: z.string().min(1).max(100),
  description: z.string().nullable(),
  region: TenantRegionSchema,
  // phase 49.1: set by the sign-up's detection or the operator's pick (internal callers; the route bodies carry only `countryCode`)
  countryCode: CountryCodeSchema.optional(),
  countrySource: z.enum(COUNTRY_SOURCES).optional(),
  slug: SlugSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  defaults: CreateTenantDefaultsDTO,
});

// A PARTIAL update: every field is optional, and the nullable ones may be sent as
// `null` to clear the stored value. `description` used to be required-but-nullable,
// which made a name-only update fail validation; `region` used to reject `null`, so
// a region could be set but never cleared. Neither DTO is parsed by a route today
// (the routes hand-roll their checks), so this only tightens the contract.
export const UpdateTenantDTO = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  region: TenantRegionEnum.nullable().optional(),
  // phase 49.1: an operator's country change (audited, the bloc `region` follows); never reached from the tenant's own profile route
  countryCode: CountryCodeSchema.optional(),
  slug: SlugSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  tenantStatus: WritableTenantStatusEnum.optional(),
});


/**
 * The operator PUT /tenants/[targetTenantId] body (tenant.03, fixed 2026-10-20): parsed BEFORE the write, so a junk status, region
 * or name is a 400 and the row is unchanged. PENDING_DELETION is not writable here at all (the deletion-request flow sets it with
 * its deleteAfter); WritableTenantStatusEnum already leaves it out, and DELETED with it (41-ui-fixes/09 A1.3).
 */
export const OperatorUpdateTenantDTO = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  region: TenantRegionEnum.nullable().optional(),
  // phase 49.1: the operator's pick; the bloc `region` is then derived from it (a `region` sent with it is ignored)
  countryCode: CountryCodeSchema.optional(),
  tenantStatus: WritableTenantStatusEnum.optional(),
});

/**
 * POST /tenants and /tenants/create body (tenant.03): a 2..100 character name, an optional string description, a known region,
 * and an optional slug in SlugSchema's format, not a reserved label (03-auth 1.3: the create-organization page asks for it, and
 * the non-strict schema used to drop it silently). Taken slugs are the service's 409.
 */
export const CreateTenantRequestDTO = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().max(2000).nullable().optional(),
  region: TenantRegionEnum.optional(),
  // phase 49.1: the country the operator picks for a tenant it creates (no country: the platform default TR, source 'default')
  countryCode: CountryCodeSchema.optional(),
  slug: SlugSchema,
});

// Self-service profile update (a tenant admin editing their OWN workspace's
// identity, e.g. the General settings tab) — deliberately narrower than
// UpdateTenantDTO: region/slug/tenantStatus/metadata stay operator-only
// (the GLOBAL-scoped /api/tenants/[targetTenantId] route).
export const UpdateOwnTenantProfileDTO = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
});

// POST /tenants/[targetTenantId]/deletion-request body. `graceDays` overrides
// the default 30-day window (TenantDeletionService.requestDeletion already
// accepted it — only the route never read it); bounded so an operator can
// shorten it for an emergency takedown or extend it for a special case
// without opening the door to a 0-day or multi-year window by typo.
export const DeletionRequestDTO = z.object({
  cancel: z.boolean().optional(),
  graceDays: z.number().int().min(1).max(365).optional(),
});

export const GetTenantDTO = z.object({
  tenantId: z.string().uuid().nullable()
}).refine((data) => data.tenantId, {
  message: "tenantId must be provided"
});

export const GetTenantsDTO = z.object({
  page: z.number().default(1),
  pageSize: z.number().default(10),
  search: z.string().nullable(),
  tenantId: z.string().uuid().nullable(),
  // phase 43 list contract (optional: internal callers leave them out)
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })).optional(),
  tenantStatus: z.array(z.string()).optional(),
  region: z.array(z.string()).optional(),
  countryCode: z.array(z.string()).optional(),
  createdFrom: z.string().optional(),
  createdTo: z.string().optional(),
});

/** Public sort fields of the tenant directory → entity properties (phase 43 list contract). */
export const TENANT_SORTABLE = {
  name: 'name',
  slug: 'slug',
  tenantStatus: 'tenantStatus',
  region: 'region',
  countryCode: 'countryCode',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

/** `page` / `pageSize` were always clamped, never refused (tenant.04): the contract's keep that. */
const clampedInt = (def: number, min: number, max: number) => z.preprocess((v) => {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : undefined;
}, z.number().int().min(min).max(max).default(def));

/**
 * The platform tenant directory (phase 43 list contract): newest first unless sorted; several statuses and regions, a
 * created-day range, a search over name and slug. 0-based, 10 rows by default; page and pageSize are clamped (0..100 000,
 * 1..200) as before.
 */
export const ListTenantsQuery = listQuerySchema({
  sortable: TENANT_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageSize: { default: 10, max: 200 },
  filters: {
    tenantStatus: listFilter.oneOf(TenantStatusEnum.options),
    region: listFilter.oneOf(ALLOWED_REGIONS),
    countryCode: listFilter.oneOf(COUNTRY_CODES),
    createdFrom: listFilter.day(),
    createdTo: listFilter.day(),
  },
}).extend({ page: clampedInt(0, 0, 100_000), pageSize: clampedInt(10, 1, 200) });

export type CreateTenantInput = z.infer<typeof CreateTenantDTO>;
export type UpdateTenantInput = z.infer<typeof UpdateTenantDTO>;
export type UpdateOwnTenantProfileInput = z.infer<typeof UpdateOwnTenantProfileDTO>;
export type DeletionRequestInput = z.infer<typeof DeletionRequestDTO>;
export type GetTenantInput = z.infer<typeof GetTenantDTO>;
export type GetTenantsInput = z.infer<typeof GetTenantsDTO>;
