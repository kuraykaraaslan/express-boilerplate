import { z } from 'zod';
import { UserStatusEnum } from './user.enums';

// ============================================================================
// Create User DTO
// ============================================================================

export const CreateUserDTO = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
  phone: z.string().optional(),
});

export type CreateUserInput = z.infer<typeof CreateUserDTO>;

// ============================================================================
// Update User DTO
// ============================================================================

export const UpdateUserDTO = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  userStatus: UserStatusEnum.optional(),
});

export type UpdateUserInput = z.infer<typeof UpdateUserDTO>;

// ============================================================================
// Get Users (pagination) DTO
// ============================================================================

export const GetUsersDTO = z.object({
  page: z.coerce.number().int().nonnegative().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
});

export type GetUsersInput = z.infer<typeof GetUsersDTO>;

// ============================================================================
// User ID DTO
// ============================================================================

export const UserIdDTO = z.object({
  userId: z.string().uuid(),
});

export type UserIdInput = z.infer<typeof UserIdDTO>;
