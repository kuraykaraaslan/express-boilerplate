import { z } from 'zod';

export const DomainStatusEnum = z.enum([
  'ACTIVE',
  'INACTIVE',
  'PENDING',
  'VERIFIED',
  'DNS_FAILED',
  // The plan no longer includes this custom domain (custom_domain off, or over max_domains): it does not serve and is
  // not linked to, and comes back on its own when the plan includes it again (tenant_domain.reconcile). Set only by the
  // platform, never by a status write.
  'SUSPENDED',
]);

/** The statuses a tenant (or an operator) may write through `update`; SUSPENDED belongs to the reconcile alone. */
export const WritableDomainStatusEnum = DomainStatusEnum.exclude(['SUSPENDED']);

export const VerificationMethodEnum = z.enum([
  'TXT',
  'CNAME'
]);

// SSL provisioning lifecycle for a custom tenant domain. The
// `ssl_provisioning.service` walks rows through these states as ACME
// (Let's Encrypt) issuance progresses.
export const SslStatusEnum = z.enum([
  'DISABLED',
  'PENDING',
  'PROVISIONING',
  'ACTIVE',
  'EXPIRING',
  'EXPIRED',
  'FAILED',
]);

export type DomainStatus = z.infer<typeof DomainStatusEnum>;
export type VerificationMethod = z.infer<typeof VerificationMethodEnum>;
export type SslStatus = z.infer<typeof SslStatusEnum>;
