import { z } from 'zod';

export const UserRoleEnum = z.enum(['USER', 'ADMIN']);
export type UserRole = z.infer<typeof UserRoleEnum>;

export const UserStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']);
export type UserStatus = z.infer<typeof UserStatusEnum>;

export const OTPMethodEnum = z.enum(['EMAIL', 'SMS', 'TOTP_APP', 'PUSH_APP']);
export type OTPMethod = z.infer<typeof OTPMethodEnum>;
