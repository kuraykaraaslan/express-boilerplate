import { z } from 'zod';

export const DomainVerificationStatusEnum = z.enum(['PENDING', 'VERIFIED', 'FAILED']);

export type DomainVerificationStatus = z.infer<typeof DomainVerificationStatusEnum>;
