import { z } from 'zod';

/**
 * The statuses an operator may set through the tenant API (`UpdateTenantDTO`). The ones below them are entered only by their own flows and are never
 * writable directly: setting PENDING_DELETION by hand would skip the deletion guards and the grace period, and the fleet statuses would skip the
 * migration contract. DELETED is not writable either (41-ui-fixes/09 A1.3): a PUT of it skipped the deletion guards and no purge ever followed; a
 * tenant is deleted through the deletion-request flow.
 */
export const WritableTenantStatusEnum = z.enum([
  'ACTIVE',
  'INACTIVE',
  'PENDING',
  'SUSPENDED',
  'ARCHIVED'
]);

/**
 * Every status a tenant row can hold (docs/phases/02-fleet/05 section 8): the writable ones, DELETED (no longer writable; rows may still hold it),
 * PENDING_DELETION (written by `tenant.deletion.service`, which the schema did not declare, so `SafeTenantSchema.parse` threw on a tenant awaiting
 * deletion), and the fleet migration states MIGRATING (frozen on the source), IMPORTING (being imported on the target, not routable) and RELOCATED
 * (the tombstone left on the source after a cutover).
 */
export const TenantStatusEnum = z.enum([...WritableTenantStatusEnum.options, 'DELETED', 'PENDING_DELETION', 'MIGRATING', 'IMPORTING', 'RELOCATED']);

export type TenantStatus = z.infer<typeof TenantStatusEnum>;
export type WritableTenantStatus = z.infer<typeof WritableTenantStatusEnum>;
