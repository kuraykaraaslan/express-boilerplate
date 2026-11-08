import { z } from 'zod';
import { DomainStatusEnum, SslStatusEnum, WritableDomainStatusEnum, VerificationMethodEnum } from './tenant_domain.enums';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';

/** One spelling per host: lower case, without the trailing root dot (DNS names are case-insensitive, RFC 4343). */
export function normalizeDomainName(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * A registrable host name in ASCII (an IDN is entered as its xn-- form): dot-separated LDH labels of 1-63 characters, at
 * least two labels, a top-level label that is not all digits. Refused (tenant_domain.04 / .09 and the DTO pin): IP literals
 * in any notation (`127.0.0.1`, `[::1]`, `0x7f.0.0.1`, `2130706433`), schemes, paths, ports, wildcards, spaces, markup,
 * control characters, zero-width and bidi characters.
 */
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME_RE = new RegExp(`^(?:${LABEL}\\.)+(?=[a-z0-9-]*[a-z])${LABEL}$`);
export function isValidDomainName(domain: string): boolean {
  return domain.length <= 253 && HOSTNAME_RE.test(domain);
}

export const CreateTenantDomainDTO = z.object({
  tenantId: z.string().uuid(),
  domain: z.string().min(1).max(255)
    .refine((d) => isValidDomainName(normalizeDomainName(d)), { message: 'Must be a host name such as shop.example.com' }),
  isPrimary: z.boolean().default(false)
});

export const UpdateTenantDomainDTO = z.object({
  isPrimary: z.boolean().optional(),
  domainStatus: WritableDomainStatusEnum.optional(),
  siteId: z.string().uuid().nullable().optional()
});

/** PATCH /api/domains/[domainId]: assign the domain to a site (null = the default site). Nothing else is writable here. */
export const AssignDomainSiteDTO = z.object({ siteId: z.string().uuid().nullable() });

/** Phase 56 (D351): add a managed base domain (the root tenant's Base domains page). */
export const CreateBaseDomainDTO = z.strictObject({
  baseDomain: z.string().trim().toLowerCase().max(253).refine((d) => isValidDomainName(d.replace(/\.$/, '')), 'Not a domain name'),
  purpose: z.enum(['tenants', 'wildcard_only']).optional(),
  challengeMode: z.enum(['delegated', 'zone']).optional(),
  selectable: z.boolean().optional(),
});

/** Phase 56 (D351): switch a managed base domain. `isDefault` can only be set (the old default is cleared); `status` only off or back on. */
export const UpdateBaseDomainDTO = z.strictObject({
  selectable: z.boolean().optional(),
  isDefault: z.literal(true).optional(),
  challengeMode: z.enum(['delegated', 'zone']).optional(),
  status: z.enum(['DISABLED', 'PENDING_DNS']).optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to change');

/** Phase 56 (D347): move the organization's free subdomain to another platform base domain. Exactly one field. */
export const ChangeBaseDomainDTO = z.strictObject({
  baseDomain: z.string().trim().toLowerCase().max(253).refine((d) => isValidDomainName(d), 'Not a domain name'),
});

export const GetTenantDomainsDTO = z.object({
  tenantId: z.string().uuid(),
  page: z.number().default(1),
  pageSize: z.number().default(10),
  // phase 43 list contract (optional: internal callers leave them out)
  domainStatus: z.array(z.string()).optional(),
  sslStatus: z.array(z.string()).optional(),
  isPrimary: z.boolean().optional(),
  search: z.string().optional(),
  sort: z.array(z.object({ field: z.string(), dir: z.enum(['asc', 'desc']) })).optional(),
});

/** Public sort fields of the domain list → entity properties (phase 43 list contract). */
export const DOMAIN_SORTABLE = {
  domain: 'domain',
  isPrimary: 'isPrimary',
  domainStatus: 'domainStatus',
  sslStatus: 'sslStatus',
  sslExpiresAt: 'sslExpiresAt',
  verifiedAt: 'verifiedAt',
  createdAt: 'createdAt',
} as const;

/** tenant_domain.06: a page / pageSize that is not a positive integer falls back to the default, a large one is capped. */
const positiveInt = (def: number, max: number) => z.preprocess((v) => {
  const n = typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : undefined;
}, z.number().int().min(1).max(max).default(def));

/**
 * The domain list (phase 43 list contract): the primary first, then newest, unless sorted; one or several domain and
 * certificate states, the primary flag, a search over the host name. 1-based, 10 rows by default, at most 100; a bad
 * page or pageSize falls back to the default as before (tenant_domain.06).
 */
export const ListTenantDomainsQuery = listQuerySchema({
  sortable: DOMAIN_SORTABLE,
  defaultSort: 'isPrimary:desc,createdAt:desc',
  pageBase: 1,
  pageSize: { default: 10, max: 100 },
  filters: {
    domainStatus: listFilter.oneOf(DomainStatusEnum.options),
    sslStatus: listFilter.oneOf(SslStatusEnum.options),
    isPrimary: listFilter.flag(),
  },
}).extend({ page: positiveInt(1, 1_000_000), pageSize: positiveInt(10, 100) });

export const InitiateVerificationDTO = z.object({
  tenantDomainId: z.string().uuid(),
  method: VerificationMethodEnum.default('TXT')
});

export const VerifyDomainDTO = z.object({
  tenantDomainId: z.string().uuid()
});

export type CreateTenantDomainInput = z.infer<typeof CreateTenantDomainDTO>;
export type UpdateTenantDomainInput = z.infer<typeof UpdateTenantDomainDTO>;
export type GetTenantDomainsInput = z.infer<typeof GetTenantDomainsDTO>;
export type InitiateVerificationInput = z.infer<typeof InitiateVerificationDTO>;
export type VerifyDomainInput = z.infer<typeof VerifyDomainDTO>;
