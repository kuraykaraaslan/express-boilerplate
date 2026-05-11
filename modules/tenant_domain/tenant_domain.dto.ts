import { z } from 'zod';

export const AddDomainDTO = z.object({
  tenantId: z.string().uuid(),
  domain: z.string().min(1).max(255),
});

export const VerifyDomainDTO = z.object({
  domainId: z.string().uuid(),
});

export const RemoveDomainDTO = z.object({
  domainId: z.string().uuid(),
});

export const SetPrimaryDomainDTO = z.object({
  domainId: z.string().uuid(),
});

export type AddDomainInput = z.infer<typeof AddDomainDTO>;
export type VerifyDomainInput = z.infer<typeof VerifyDomainDTO>;
export type RemoveDomainInput = z.infer<typeof RemoveDomainDTO>;
export type SetPrimaryDomainInput = z.infer<typeof SetPrimaryDomainDTO>;
