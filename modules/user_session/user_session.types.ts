import { z } from 'zod';

// Helper to coerce dates from JSON (handles both Date and string)
const dateOrString = z
  .union([z.date(), z.string().datetime()])
  .transform((val) => (typeof val === 'string' ? new Date(val) : val));

const dateOrStringNullable = z
  .union([z.date(), z.string().datetime()])
  .transform((val) => (typeof val === 'string' ? new Date(val) : val))
  .nullable();

export const UserSessionSchema = z.object({
  userSessionId: z.string().uuid(),
  userId: z.string().uuid(),
  accessToken: z.string(),
  refreshToken: z.string(),
  sessionExpiry: dateOrString,
  deviceFingerprint: z.string().nullable().optional(),
  otpVerifyNeeded: z.boolean().default(false),
  otpVerifiedAt: dateOrStringNullable.optional(),
  ip: z.string().nullable().optional(),
  os: z.string().nullable().optional(),
  device: z.string().nullable().optional(),
  browser: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  createdAt: dateOrStringNullable,
  updatedAt: dateOrStringNullable,
});

export const SafeUserSessionSchema = UserSessionSchema.omit({
  accessToken: true,
  refreshToken: true,
});

export type UserSession = z.infer<typeof UserSessionSchema>;
export type SafeUserSession = z.infer<typeof SafeUserSessionSchema>;
