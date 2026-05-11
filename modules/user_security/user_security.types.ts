import { z } from 'zod';
import { OTPMethodEnum } from './user_security.enums';

// Helper to coerce dates from JSON
const dateOrString = z
  .union([z.date(), z.string().datetime()])
  .transform((val) => (typeof val === 'string' ? new Date(val) : val))
  .nullable();

export const UserSecuritySchema = z.object({
  userSecurityId: z.string().uuid(),
  userId: z.string(),
  failedLoginAttempts: z.number().int().default(0),
  lockedUntil: dateOrString.optional(),
  otpMethods: z.array(OTPMethodEnum).nullish().transform((val) => val ?? []),
  otpSecret: z.string().nullable().optional(),
  otpBackupCodes: z.array(z.string()).nullish().transform((val) => val ?? []),
  emailVerifiedAt: dateOrString.optional(),
  lastLoginAt: dateOrString.optional(),
  lastLoginIp: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SafeUserSecuritySchema = UserSecuritySchema.omit({
  otpSecret: true,
  otpBackupCodes: true,
});

export type UserSecurity = z.infer<typeof UserSecuritySchema>;
export type SafeUserSecurity = z.infer<typeof SafeUserSecuritySchema>;
