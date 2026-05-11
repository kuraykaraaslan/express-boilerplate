import { z } from 'zod';
import { UserRoleEnum, UserStatusEnum } from './user.enums';

// Helper to coerce dates from JSON (handles both Date and string)
const dateOrString = z
  .union([z.date(), z.string().datetime()])
  .transform((val) => (typeof val === 'string' ? new Date(val) : val))
  .nullable();

export const UserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  userRole: UserRoleEnum.default('USER'),
  userStatus: UserStatusEnum.default('ACTIVE'),
  createdAt: dateOrString,
  updatedAt: dateOrString,
  deletedAt: dateOrString,
});

export const SafeUserSchema = UserSchema.omit({
  password: true,
  deletedAt: true,
});

export type User = z.infer<typeof UserSchema>;
export type SafeUser = z.infer<typeof SafeUserSchema>;
