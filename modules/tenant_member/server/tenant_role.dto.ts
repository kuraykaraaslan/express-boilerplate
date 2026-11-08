import { z } from 'zod';

// Custom role keys are namespaced, lowercase; built-in keys (OWNER/ADMIN/USER)
// are reserved and created only by the seeder, never through these DTOs.
export const RoleKeySchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, 'Invalid role key');

export const CreateRoleDTO = z.object({
  key: RoleKeySchema,
  label: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  permissions: z.array(z.string().max(128)).max(500).default([]),
});

export const UpdateRoleDTO = z.object({
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  permissions: z.array(z.string().max(128)).max(500).optional(),
  isActive: z.boolean().optional(),
});

export const SetGrantDTO = z.object({
  roleKey: z.string().min(1).max(64),
  permissionId: z.string().min(1).max(128),
  granted: z.boolean(),
});

export const SaveMatrixDTO = z.object({
  changes: z.array(SetGrantDTO).min(1).max(2000),
});

export type CreateRoleInput = z.infer<typeof CreateRoleDTO>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleDTO>;
export type SetGrantInput = z.infer<typeof SetGrantDTO>;
export type SaveMatrixInput = z.infer<typeof SaveMatrixDTO>;
