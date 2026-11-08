import { z } from 'zod';
import { UserRoleEnum, AssignableUserStatusEnum, UserStatusEnum } from './user.enums';
import { listQuerySchema, listFilter } from '@kuraykaraaslan-labs/common/server/common.list-query';

// ============================================================================
// User Management DTOs
// ============================================================================

// 06-user 1.1: phone and userStatus may be left out (the create form sends neither); absent and null mean the same.
export const CreateUserRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().nullish(),
  userRole: UserRoleEnum.nullish().transform(val => val ?? 'USER'),
  userStatus: AssignableUserStatusEnum.nullish().transform(val => val ?? 'ACTIVE')
});

/** Absent or null = leave it as it is. */
const keep = <T extends z.ZodType>(schema: T) => schema.nullish().transform((v) => v ?? undefined);

/**
 * A user edit carries only what changed (06-user 1.4): an absent key is kept. `phone: null` clears the phone; an email cannot be
 * cleared, so `email: null` is refused (code EMAIL_REQUIRED); a null role or status means "no change". An edit that changes nothing
 * is refused.
 */
export const UpdateUserRequestSchema = z.object({
  email: z.string().email().nullish().refine((v) => v !== null, {
    message: 'An account must keep an email address.',
    params: { code: 'EMAIL_REQUIRED' },
  }),
  phone: z.string().nullish(),
  userRole: keep(UserRoleEnum),
  userStatus: keep(AssignableUserStatusEnum),
}).refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nothing to update.' });

export const GetAllUsersQuerySchema = z.object({
  page: z.number().int().nonnegative().default(0),
  pageSize: z.number().int().positive().max(100).default(10),
  search: z.string().nullable(),
  userId: z.string().nullable()
});

/** The platform user directory's sortable columns (outward key → entity field). */
export const USER_SORTABLE = {
  email: 'email',
  userRole: 'userRole',
  userStatus: 'userStatus',
  createdAt: 'createdAt',
} as const;

/**
 * GET /api/users (phase 43 list contract): newest first unless sorted; several roles and statuses, a joined-day range,
 * a search over the email. 0-based, 10 rows by default, at most 100 (the size was unbounded).
 */
export const ListUsersQuery = listQuerySchema({
  sortable: USER_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageSize: { default: 10, max: 100 },
  filters: {
    userRole: listFilter.oneOf(UserRoleEnum.options),
    userStatus: listFilter.oneOf(UserStatusEnum.options),
    createdFrom: listFilter.day(),
    createdTo: listFilter.day(),
  },
});

export const GetUserByIdSchema = z.object({
  userId: z.string()
});

export const DeleteUserSchema = z.object({
  userId: z.string()
});

// ============================================================================
// Type Exports
// ============================================================================

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
export type GetAllUsersQuery = z.infer<typeof GetAllUsersQuerySchema>;
export type GetUserById = z.infer<typeof GetUserByIdSchema>;
export type DeleteUser = z.infer<typeof DeleteUserSchema>;

/**
 * POST /api/users/{id}/security-lock (phase 55 00.1): why (required, kept with the lock and in the audit row, never shown to the person)
 * and, optionally, when it ends by itself (an ISO date-time in the future; absent or null = until an unlock). Nothing else is accepted.
 */
export const SecurityLockRequestSchema = z.object({
  reason: z.string().trim().min(3, 'A reason of at least 3 characters is required.').max(500, 'The reason is too long (500 characters at most).'),
  until: z.string().datetime({ offset: true }).nullish()
    .transform((v) => (v ? new Date(v) : null))
    .refine((d) => d === null || d.getTime() > Date.now(), { message: 'The end of the lock must be a time in the future.' }),
}).strict();

/** DELETE /api/users/{id}/security-lock: an optional note on why the lock is lifted. */
export const SecurityUnlockRequestSchema = z.object({
  reason: z.string().trim().max(500, 'The reason is too long (500 characters at most).').nullish(),
}).strict();

/**
 * Phase 55 00.6: the admin actuators (end sessions, force or lift a step-up, revoke trusted devices, force or lift a password
 * change) take an optional operator's note, kept in the audit row only. Nothing else is accepted.
 */
export const AdminActionNoteSchema = z.object({
  reason: z.string().trim().max(500, 'The reason is too long (500 characters at most).').nullish(),
}).strict();
