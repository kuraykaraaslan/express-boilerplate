import { z } from 'zod';

export const TenantMemberRoleEnum = z.enum([
  'OWNER',
  'ADMIN',
  'USER'
]);

export const TenantMemberStatusEnum = z.enum([
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'PENDING'
]);

export type TenantMemberRole = z.infer<typeof TenantMemberRoleEnum>;
export type TenantMemberStatus = z.infer<typeof TenantMemberStatusEnum>;

/**
 * The role space used for ABAC permission *floors* (`minRole`) and rank
 * comparisons. It extends the assignable member roles with `GUEST` (rank 0),
 * a **floor sentinel meaning "public / no membership required"** — GUEST is
 * NEVER a stored `memberRole` nor an assignable/matrix role; it only appears as
 * a permission's `minRole` and as rank 0. See `authorizeRequest` (GUEST scope).
 */
export type PermissionFloor = TenantMemberRole | 'GUEST';
