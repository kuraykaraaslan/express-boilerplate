import { z } from 'zod';
import { DomainVerificationStatusEnum } from './tenant_domain.enums';

export const TenantDomainSchema = z.object({
  domainId: z.string().uuid(),
  tenantId: z.string().uuid(),
  domain: z.string(),
  isPrimary: z.boolean().default(false),
  verificationStatus: DomainVerificationStatusEnum.default('PENDING'),
  verificationToken: z.string().nullable(),
  verifiedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date().nullable(),
  updatedAt: z.coerce.date().nullable(),
});

export const SafeTenantDomainSchema = TenantDomainSchema.omit({
  verificationToken: true,
});

export type TenantDomain = z.infer<typeof TenantDomainSchema>;
export type SafeTenantDomain = z.infer<typeof SafeTenantDomainSchema>;
