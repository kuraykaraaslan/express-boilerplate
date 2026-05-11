import { z } from 'zod';

export const OTPMethodEnum = z.enum(['EMAIL', 'SMS', 'TOTP_APP']);

export type OTPMethod = z.infer<typeof OTPMethodEnum>;
