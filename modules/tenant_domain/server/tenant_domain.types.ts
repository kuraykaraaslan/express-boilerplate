import { z } from 'zod';
import { DomainStatusEnum, SslStatusEnum, VerificationMethodEnum } from './tenant_domain.enums';

export const TenantDomainSchema = z.object({
  tenantDomainId: z.string().uuid(),
  tenantId: z.string().uuid(),
  domain: z.string(),
  isPrimary: z.boolean().default(false),
  // The site this domain serves (a dynamic_page site id); null = the tenant's default site.
  siteId: z.string().uuid().nullish(),
  domainStatus: DomainStatusEnum.default('PENDING'),
  verificationToken: z.string().nullable(),
  verifiedAt: z.coerce.date().nullable(),
  sslStatus: SslStatusEnum.default('DISABLED'),
  sslIssuedAt: z.coerce.date().nullable(),
  sslExpiresAt: z.coerce.date().nullable(),
  sslIssuer: z.string().nullable(),
  sslLastCheckedAt: z.coerce.date().nullable(),
  // Set while the platform holds the domain SUSPENDED (tenant_domain.reconcile): when, and what to restore.
  suspendedAt: z.coerce.date().nullish(),
  statusBeforeSuspension: DomainStatusEnum.nullish(),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable()
});

export const SafeTenantDomainSchema = TenantDomainSchema.omit({
  verificationToken: true
});

export const DomainVerificationInfoSchema = z.object({
  domain: z.string(),
  method: VerificationMethodEnum,
  recordName: z.string(),
  recordValue: z.string(),
  domainStatus: DomainStatusEnum
});

export type TenantDomain = z.infer<typeof TenantDomainSchema>;
export type SafeTenantDomain = z.infer<typeof SafeTenantDomainSchema>;
export type DomainVerificationInfo = z.infer<typeof DomainVerificationInfoSchema>;
