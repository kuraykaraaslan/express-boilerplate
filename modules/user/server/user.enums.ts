import { z } from 'zod';

export const UserRoleEnum = z.enum(['USER', 'ADMIN']);
// DELETED is the terminal state `erase()` and a merge write; it is read-only — no request
// may set it (see AssignableUserStatusEnum), but a row in that state must still parse.
export const UserStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DELETED']);
/** The statuses an admin may assign. */
export const AssignableUserStatusEnum = UserStatusEnum.exclude(['DELETED']);

export type UserRole = z.infer<typeof UserRoleEnum>;
export type UserStatus = z.infer<typeof UserStatusEnum>;
