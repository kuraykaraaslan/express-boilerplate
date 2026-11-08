import { z } from 'zod';
import { UserRoleEnum, UserStatusEnum, AssignableUserStatusEnum } from './user.enums';
import { UserProfileSchema } from './user-profile.schema';

// Helper to coerce dates from JSON (handles both Date and string)
const dateOrString = z.union([z.date(), z.string().datetime()]).transform(val => 
  typeof val === 'string' ? new Date(val) : val
).nullable();

export const UserSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  // NULL for a Fleet ID shadow user (FID-07): it has no local password and can never pass a password check.
  password: z.string().min(8, "Password must be at least 8 characters long").nullable(),
  userRole: UserRoleEnum.default('USER'),
  userStatus: UserStatusEnum.default('ACTIVE'),
  emailVerifiedAt: dateOrString,
  createdAt: dateOrString,
  updatedAt: dateOrString,
  deletedAt: dateOrString
});

export const SafeUserSchema = UserSchema.omit({
  password: true,
  deletedAt: true
}).extend({
  userProfile: z.object(UserProfileSchema.shape).nullable().optional()
});

export const UpdateUserSchema = z.object({
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  userRole: UserRoleEnum.nullable().optional(),
  userStatus: AssignableUserStatusEnum.nullable().optional(),
});

export type User = z.infer<typeof UserSchema>;
export type SafeUser = z.infer<typeof SafeUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;

/**
 * 06-user 2.1: the account's membership of the root tenant, as the platform user admin reads it (any status, so a suspended root OWNER
 * still counts). null = no root membership; absent = not known (the lookup failed), which readers treat as privileged. Only GET /users
 * and GET /users/{id} add it, both behind `user.users.read`.
 */
export type RootMembershipFields = { rootMemberRole?: string | null; rootMemberStatus?: string | null };
export type SafeUserWithRootMembership = SafeUser & RootMembershipFields;
